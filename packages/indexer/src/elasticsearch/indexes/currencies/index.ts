/* eslint-disable @typescript-eslint/no-explicit-any */
import { logger } from "@/common/logger";
import { config } from "@/config/index";

import { elasticsearchCurrencies as elasticsearch } from "@/common/elasticsearch";
import { CurrencyDocument } from "@/elasticsearch/indexes/currencies/base";
import { isAddress } from "@ethersproject/address";
import { isRetryableError } from "@/elasticsearch/indexes/utils";

const INDEX_NAME = config.elasticsearchCurrenciesIndexName || `currencies`;

export const save = async (currencies: CurrencyDocument[], upsert = true): Promise<void> => {
  try {
    const response = await elasticsearch.bulk({
      body: currencies.flatMap((currency) => [
        { [upsert ? "index" : "create"]: { _index: INDEX_NAME, _id: currency.id } },
        currency,
      ]),
    });

    logger.info(
      "elasticsearch-currencies",
      JSON.stringify({
        topic: "save-conflicts",
        upsert,
        data: {
          currencies: JSON.stringify(currencies),
        },
        response,
      })
    );

    if (response.errors) {
      if (upsert) {
        logger.error(
          "elasticsearch-currencies",
          JSON.stringify({
            topic: "save-errors",
            upsert,
            data: {
              currencies: JSON.stringify(currencies),
            },
            response,
          })
        );
      } else {
        logger.debug(
          "elasticsearch-currencies",
          JSON.stringify({
            topic: "save-conflicts",
            upsert,
            data: {
              currencies: JSON.stringify(currencies),
            },
            response,
          })
        );
      }
    }
  } catch (error) {
    logger.error(
      "elasticsearch-currencies",
      JSON.stringify({
        topic: "save",
        upsert,
        data: {
          currencies: JSON.stringify(currencies),
        },
        error,
      })
    );

    throw error;
  }
};
export const getIndexName = (): string => {
  return INDEX_NAME;
};

export const autocomplete = async (
  params: {
    prefix: string;
    chainIds?: number[];
    fuzzy?: boolean;
    limit?: number;
  },
  retries = 0
): Promise<{ currency: CurrencyDocument; score: number }[]> => {
  let esQuery = undefined;
  let esSuggest = undefined;

  try {
    if (isAddress(params.prefix)) {
      esQuery = {
        bool: {
          filter: [
            {
              terms: { ["chainId"]: params.chainIds },
            },
            {
              term: { contract: params.prefix },
            },
          ],
        },
      };

      const esSearchParams = {
        index: INDEX_NAME,
        query: esQuery,
        size: params.limit,
      };

      const esResult = await elasticsearch.search<CurrencyDocument>(esSearchParams);

      const results: { currency: CurrencyDocument; score: number }[] = esResult.hits.hits.map(
        (hit) => {
          return { currency: hit._source!, score: hit._score! };
        }
      );

      return results;
    } else {
      esSuggest = {
        prefix_suggestion: {
          prefix: params.prefix,
          completion: {
            field: "suggest",
            fuzzy: !!params.fuzzy,
            size: params.limit ?? 20,
            contexts: {
              chainId: params.chainIds?.map((chainId) => `${chainId}`),
            },
          },
        },
      };

      const esSearchParams = {
        index: INDEX_NAME,
        suggest: esSuggest,
      };

      const esResult = await elasticsearch.search<CurrencyDocument>(esSearchParams);

      const results: { currency: CurrencyDocument; score: number }[] =
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        esResult.suggest?.prefix_suggestion[0].options.map((option: any) => {
          return { currency: option._source!, score: option._score! };
        });

      return results;
    }
  } catch (error) {
    if (isRetryableError(error)) {
      logger.warn(
        "elasticsearch-currency",
        JSON.stringify({
          topic: "autocompleteCurrencies",
          message: "Retrying...",
          params,
          esQuery,
          esSuggest,
          error,
          retries,
        })
      );

      if (retries <= 3) {
        retries += 1;
        return autocomplete(params, retries);
      }

      logger.error(
        "elasticsearch-currency",
        JSON.stringify({
          topic: "autocompleteCurrencies",
          message: "Max retries reached.",
          params,
          esQuery,
          esSuggest,
          error,
          retries,
        })
      );

      throw new Error("Could not perform search.");
    } else {
      logger.error(
        "elasticsearch-currency",
        JSON.stringify({
          topic: "autocompleteCurrencies",
          message: "Unexpected error.",
          params,
          esQuery,
          esSuggest,
          error,
        })
      );
    }

    throw error;
  }
};
