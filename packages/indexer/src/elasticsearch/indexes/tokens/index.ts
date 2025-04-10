/* eslint-disable @typescript-eslint/no-explicit-any */

import { elasticsearchTokens as elasticsearch } from "@/common/elasticsearch";
import { logger } from "@/common/logger";

import { getChainName } from "@/config/network";

import { TokenDocument } from "@/elasticsearch/indexes/tokens/base";
import { config } from "@/config/index";

const INDEX_NAME = `${getChainName()}.${config.elasticsearchTokensIndexName || "tokens"}`;

export const save = async (documents: TokenDocument[], upsert = true): Promise<void> => {
  try {
    const response = await elasticsearch.bulk({
      body: documents.flatMap((document) => [
        { [upsert ? "index" : "create"]: { _index: INDEX_NAME, _id: document.id } },
        document,
      ]),
    });

    if (response.errors) {
      if (upsert) {
        logger.error(
          "elasticsearch-tokens",
          JSON.stringify({
            topic: "save-errors",
            upsert,
            documents: JSON.stringify(documents),
            response,
          })
        );
      } else {
        logger.debug(
          "elasticsearch-tokens",
          JSON.stringify({
            topic: "save-conflicts",
            upsert,
            documents: JSON.stringify(documents),
            response,
          })
        );
      }
    }
  } catch (error) {
    logger.error(
      "elasticsearch-tokens",
      JSON.stringify({
        topic: "save",
        upsert,
        documents: JSON.stringify(documents),
        error,
      })
    );

    throw error;
  }
};

export const getIndexName = (): string => {
  return INDEX_NAME;
};
export const getAttributeTokenCount = async (
  collection: string,
  key: string,
  value: string
): Promise<number> => {
  const esQuery = {};

  (esQuery as any).bool = {
    filter: [
      {
        term: {
          "collection.id": collection.toLowerCase(),
        },
      },
      {
        term: {
          [`attributes.${key}`]: value,
        },
      },
      {
        term: {
          hasRemainingSupply: true,
        },
      },
    ],
  };

  const esSearchParams = {
    index: INDEX_NAME,
    query: esQuery,
  };

  const esResult = await elasticsearch.count(esSearchParams);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return Number(esResult.count);
};

export const getAttributeKeyValuesCount = async (
  collection: string,
  key: string
): Promise<number> => {
  const esQuery = {};
  const esAggs = {};

  (esQuery as any).bool = {
    filter: [
      {
        term: {
          "collection.id": collection.toLowerCase(),
        },
      },
      {
        term: {
          hasRemainingSupply: true,
        },
      },
    ],
  };

  (esAggs as any).uniqueValues = {
    cardinality: {
      field: `attributes.${key}`,
    },
  };

  const esSearchParams = {
    index: INDEX_NAME,
    query: esQuery,
    aggs: esAggs,
    size: 0,
  };

  const esResult = await elasticsearch.search(esSearchParams);

  return (esResult?.aggregations?.uniqueValues as any).value;
};

export const getCollectionSupply = async (
  collection: string
): Promise<{ supply: number; remainingSupply: number }> => {
  const esQuery = {};
  const esAggs = {};

  (esQuery as any).bool = {
    filter: [
      {
        term: {
          "collection.id": collection.toLowerCase(),
        },
      },
      {
        term: {
          hasRemainingSupply: true,
        },
      },
    ],
  };

  (esAggs as any).totaSupply = {
    sum: {
      field: "supply",
    },
  };

  (esAggs as any).totalRemainingSupply = {
    sum: {
      field: "remainingSupply",
    },
  };

  const esSearchParams = {
    index: INDEX_NAME,
    query: esQuery,
    aggs: esAggs,
    size: 0,
  };

  const esResult = await elasticsearch.search(esSearchParams);

  const supply = (esResult?.aggregations?.totaSupply as any).value;
  const remainingSupply = (esResult?.aggregations?.totalRemainingSupply as any).value;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return {
    supply,
    remainingSupply,
  };
};

export const getCollectionTokenCount = async (collection: string): Promise<number> => {
  const esQuery = {};

  (esQuery as any).bool = {
    filter: [
      {
        term: {
          "collection.id": collection.toLowerCase(),
        },
      },
      {
        term: {
          hasRemainingSupply: true,
        },
      },
    ],
  };

  const esSearchParams = {
    index: INDEX_NAME,
    query: esQuery,
  };

  const esResult = await elasticsearch.count(esSearchParams);

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return Number(esResult.count);
};
