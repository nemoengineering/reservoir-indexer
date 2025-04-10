/* eslint-disable @typescript-eslint/no-explicit-any */

import { RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { fromBuffer, now } from "@/common/utils";
import { ridb } from "@/common/db";
import { config } from "@/config/index";

const version = "v1";

export const getFungibleTokenListV1Options: RouteOptions = {
  description: "Fungible Tokens",
  notes: "Get fungible data by contract address.",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  response: {
    schema: Joi.object({
      name: Joi.string(),
      timestamp: Joi.string(),
      version: Joi.object({
        major: Joi.number(),
        minor: Joi.number(),
        patch: Joi.number(),
      }),
      tokens: Joi.array().items(
        Joi.object({
          name: Joi.string().allow(""),
          decimals: Joi.number(),
          symbol: Joi.string().uppercase().allow(null, ""),
          address: Joi.string().lowercase(),
          chainId: Joi.number(),
          logoURI: Joi.string(),
        })
      ),
    }).label(`getFungibleTokenList${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-fungible-tokenlist--${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async () => {
    const tokens: {
      name?: string | null;
      decimals: number | null;
      symbol: string | null;
      address: string;
      chainId: number;
      logoURI: string | null;
    }[] = [];

    const currencies = await ridb.manyOrNone(`
      SELECT currencies.*
      FROM currencies
      ORDER BY hour24_volume_usd DESC LIMIT 20
    `);

    for (const currency of currencies) {
      const token = {
        name: currency.name ?? "",
        decimals: currency.decimals ?? 0,
        symbol: currency.symbol ?? "",
        address: fromBuffer(currency.contract),
        chainId: config.chainId,
        logoURI: currency?.metadata?.image,
      };

      tokens.push(token);
    }

    const currentTimestamp = now(); // Current Unix timestamp in seconds
    const minorVersion = currentTimestamp - (currentTimestamp % 3600); // Round down to nearest hour

    return {
      name: "ReservoirSwap Token List",
      timestamp: new Date().toISOString(),
      version: { major: 1, minor: minorVersion, patch: 0 },
      tokens,
    };
  },
};
