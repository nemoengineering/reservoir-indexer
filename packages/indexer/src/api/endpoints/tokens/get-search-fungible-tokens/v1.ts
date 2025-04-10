/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { regex } from "@/common/utils";

import * as currenciesIndex from "@/elasticsearch/indexes/currencies";
import { config } from "@/config/index";

const version = "v1";

export const getSearchFungibleTokensV1Options: RouteOptions = {
  description: "Search Fungible Tokens",
  notes: "Search fungible tokens",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      prefix: Joi.string()
        .lowercase()
        .required()
        .description("Lightweight search for tokens that match a string."),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(20)
        .description("Amount of items returned in response. Max limit is 20."),
    }),
  },
  response: {
    schema: Joi.object({
      tokens: Joi.array().items(
        Joi.object({
          contract: Joi.string().lowercase().pattern(regex.address),
          metadata: Joi.object({
            image: Joi.string(),
          }),
          name: Joi.string().allow(null),
          symbol: Joi.string().uppercase().allow(null, ""),
          decimals: Joi.number().allow(null),
          totalSupply: Joi.string().allow(null),
        })
      ),
    }).label(`getSearchFungibleTokens${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(
        `get-search-fungible-tokens-${version}-handler`,
        `Wrong response schema: ${error}`
      );
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    if (!config.enableElasticsearchCurrencies) {
      return { tokens: [] };
    }

    // Search for any matching ERC20 token
    const results = await currenciesIndex.autocomplete({
      prefix: query.prefix,
      chainIds: [config.chainId],
      limit: query.limit,
    });

    const tokens = results?.map(async ({ currency }) => {
      return {
        contract: currency.contract,
        metadata: {
          image: currency?.metadata?.image ?? undefined,
        },
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.decimals,
        totalSupply: currency.totalSupply,
      };
    });

    return { tokens: await Promise.all(tokens) };
  },
};
