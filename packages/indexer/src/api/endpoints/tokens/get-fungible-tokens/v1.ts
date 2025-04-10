/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { bn, formatUsd, fromBuffer, regex, toBuffer } from "@/common/utils";
import { ridb } from "@/common/db";
import _ from "lodash";
import { getCurrency } from "@/utils/currencies";
import { CurrencyMetadata } from "@/models/currencies";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import { l1BaseProvider } from "@/common/provider";
import { redis } from "@/common/redis";
import { parseUnits, formatUnits } from "@ethersproject/units";
import { USD_DECIMALS } from "@/utils/prices";
import { ethers } from "ethers";
import { Assets, ImageSize } from "@/utils/assets";

const version = "v1";

interface IToken {
  contract: string;
  metadata: CurrencyMetadata;
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  totalSupply: string | null;
  volume: any | null;
  usdPrice: number | null;
  usdPriceChange: any | null;
  fdv: any | null;
  fdvChange: any | null;
}

export const getFungibleTokensV1Options: RouteOptions = {
  cache: {
    privacy: "public",
    expiresIn: 60000,
  },
  description: "Fungible Tokens",
  notes: "Get fungible data by contract address.",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      contracts: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().lowercase().pattern(regex.address)).max(20),
          Joi.string().lowercase().pattern(regex.address)
        )
        .description(
          "Array of contracts. Max amount is 20. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
        ),
      sortBy: Joi.string()
        .valid(
          "1DayVolume",
          "7DayVolume",
          "30DayVolume",
          "allTimeVolume",
          "1DayFdvChange",
          "24HourVolume"
        )
        .default("allTimeVolume")
        .description(
          "Order the items are returned in the response. Options are `#DayVolume` / `allTimeVolume` / `#DayFdvChange`"
        ),
      sortDirection: Joi.string().lowercase().valid("asc", "desc").default("desc"),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(20)
        .description("Amount of items returned in response. Max limit is 20.")
        .when("contracts", {
          is: Joi.exist(),
          then: Joi.number().integer().max(20),
          otherwise: Joi.number().integer().max(100),
        }),
      continuation: Joi.string().allow(null),
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
          volume: Joi.object({
            "24hour": Joi.object({
              raw: Joi.string(),
              usd: Joi.number(),
            }),
            "1day": Joi.object({
              raw: Joi.string(),
              usd: Joi.number(),
            }),
            "7day": Joi.object({
              raw: Joi.string(),
              usd: Joi.number(),
            }),
            "30day": Joi.object({
              raw: Joi.string(),
              usd: Joi.number(),
            }),
            allTime: Joi.object({
              raw: Joi.string(),
              usd: Joi.number(),
            }),
          }).allow(null),
          usdPrice: Joi.number().allow(null),
          usdPriceChange: Joi.object({
            "1day": Joi.number().allow(null),
            "7day": Joi.number().allow(null),
            "30day": Joi.number().allow(null),
          }).allow(null),
          fdv: Joi.object({
            "1day": Joi.string().allow(null),
          }).allow(null),
          fdvChange: Joi.object({
            "1day": Joi.number().unsafe().allow(null),
          }).allow(null),
        })
      ),
    }).label(`getFungibleTokens${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-fungible-tokens-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;
    const conditions: string[] = [];
    let hideWNative = false;
    let nativeCurrency;
    let nativeTotalSupply;

    // Accessing the raw query string
    const rawQuery = request.url.search || "";
    const queryString = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
    const requestCacheKey = `/fungibles/v1:${queryString}`;
    const cacheResponse = await redis.get(requestCacheKey);
    if (cacheResponse) {
      return { tokens: JSON.parse(cacheResponse) };
    }

    conditions.push(`is_spam = 0`);

    if (query.contracts) {
      if (!Array.isArray(query.contracts)) {
        query.contracts = [query.contracts];
      }

      conditions.push(`contract IN ($/contracts:list/)`);
    } else {
      query.contracts = [];
    }

    // If no specific contracts or user query specifically the native token
    if (
      _.isEmpty(query.contracts) ||
      query.contracts.includes(Sdk.Common.Addresses.Native[config.chainId])
    ) {
      nativeCurrency = await getCurrency(Sdk.Common.Addresses.Native[config.chainId]);

      // Make sure to fetch the wrapped native info if querying specifically native token
      // Only allow the wrapped native if it exists
      const wNativeContract = Sdk.Common.Addresses.WNative[config.chainId];
      if (wNativeContract && !query.contracts.includes(wNativeContract)) {
        hideWNative = true;
        query.contracts.push(wNativeContract);
      }

      // If we have canonical bridge available use the contract balance for total Native token supply
      if (
        config.canonicalBridge &&
        config.l1TokenAddress &&
        config.l1BaseNetworkHttpUrl &&
        config.l1ChainId
      ) {
        const cacheKey = `canonical-bridge-balance`;
        nativeTotalSupply = await redis.get(cacheKey);

        if (!nativeTotalSupply) {
          const contract = new ethers.Contract(
            config.canonicalBridge,
            ["function chainBalance(uint256 chainId, address l1Token) view returns (uint256)"],
            l1BaseProvider
          );

          nativeTotalSupply = await contract.chainBalance(config.chainId, config.l1TokenAddress);

          await redis.set(cacheKey, nativeTotalSupply.toString(), "EX", 60);
        }
      } else {
        // todo implement 3rd party api to get native token total supply
      }
    }

    let sortBy = "all_time_volume_usd";

    switch (query.sortBy) {
      case "24HourVolume":
        sortBy = "hour24_volume_usd";
        break;
      case "1DayVolume":
        sortBy = "day1_volume_usd";
        break;

      case "7DayVolume":
        sortBy = "day7_volume_usd";
        break;

      case "30DayVolume":
        sortBy = "day30_volume_usd";
        break;
    }

    // TODO refine this query for scalability
    const currenciesQuery = `
      WITH top_currencies AS (
        SELECT *
        FROM currencies
        WHERE EXISTS (SELECT 1 FROM usd_prices_minutely WHERE currency = currencies.contract LIMIT 1)
        ${conditions.length ? `AND ${conditions.map((c) => `(${c})`).join(" AND ")}` : ""}
        ORDER BY ${sortBy} ${query.sortDirection}
        LIMIT ${query.limit}
      ) 
      SELECT tc.*, COALESCE(r.value, 0) AS realtime_value_usd_v3, COALESCE(y.value,0) AS yesterday_value_usd_v3,
             COALESCE(a.value, 0) AS realtime_value_usd_v2, COALESCE(b.value, 0) AS yesterday_value_usd_v2
      FROM top_currencies tc
      LEFT JOIN LATERAL (
        SELECT value, provider
        FROM usd_prices_minutely 
        WHERE currency = tc.contract
        AND provider = 'uniswap-v3'
        ORDER BY timestamp DESC
        LIMIT 1
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT value, provider
        FROM usd_prices_minutely 
        WHERE currency = tc.contract
        AND provider = 'uniswap-v2'
        ORDER BY timestamp DESC
        LIMIT 1
      ) a ON TRUE
      LEFT JOIN LATERAL (
        SELECT value, provider
        FROM usd_prices
        WHERE currency = tc.contract AND provider = r.provider
        ORDER BY timestamp DESC
        LIMIT 1
      ) y ON TRUE
      LEFT JOIN LATERAL (
        SELECT value, provider
        FROM usd_prices
        WHERE currency = tc.contract AND provider = a.provider
        ORDER BY timestamp DESC
        LIMIT 1
      ) b ON TRUE
      WHERE r.value IS NOT NULL OR a.value IS NOT NULL
    `;

    let tokens: IToken[] = [];

    const currencies = await ridb.manyOrNone(currenciesQuery, {
      contracts: query.contracts ? query.contracts.map(toBuffer) : undefined,
    });

    if (currencies.length) {
      for (const currency of currencies) {
        let realtime_value_usd = Math.min(
          Number(currency.realtime_value_usd_v2),
          Number(currency.realtime_value_usd_v3)
        );

        if (!realtime_value_usd) {
          realtime_value_usd = Math.max(
            Number(currency.realtime_value_usd_v2),
            Number(currency.realtime_value_usd_v3)
          );
        }

        const fdv = bn(currency.total_supply ?? 0).mul(realtime_value_usd);

        const token = {
          contract: fromBuffer(currency.contract),
          metadata: {
            image: Assets.getResizedImageUrl(currency?.metadata?.image, ImageSize.small),
          },
          name: currency.name,
          symbol: currency.symbol,
          decimals: currency.decimals,
          totalSupply: currency.total_supply,
          volume: {
            "24hour": {
              raw: currency.hour24_volume,
              usd: formatUsd(currency.hour24_volume_usd),
            },
            "1day": {
              raw: currency.day1_volume,
              usd: formatUsd(currency.day1_volume_usd),
            },
            "7day": {
              raw: currency.day7_volume,
              usd: formatUsd(currency.day7_volume_usd),
            },
            "30day": {
              raw: currency.day30_volume,
              usd: formatUsd(currency.day30_volume_usd),
            },
            allTime: {
              raw: currency.all_time_volume,
              usd: formatUsd(currency.all_time_volume_usd),
            },
          },
          usdPrice: formatUsd(realtime_value_usd),
          usdPriceChange: {
            "1day": Number(currency.day1_volume_usd)
              ? _.round(Number(realtime_value_usd) / Number(currency.day1_volume_usd), 6)
              : null,
            "7day": Number(currency.day7_volume_usd)
              ? _.round(Number(realtime_value_usd) / Number(currency.day7_volume_usd), 6)
              : null,
            "30day": Number(currency.day30_volume_usd)
              ? _.round(Number(realtime_value_usd) / Number(currency.day30_volume_usd), 6)
              : null,
          },
          fdv: {
            "1day": formatUnits(fdv, USD_DECIMALS).toString().replace(/\.0$/, ""),
          },
          fdvChange: {
            "1day": Number(currency.day1_fdv)
              ? _.round(Number(fdv) / Number(currency.day1_fdv), 6)
              : null,
          },
        };

        if (
          fromBuffer(currency.contract) !== Sdk.Common.Addresses.WNative[config.chainId] ||
          !hideWNative
        ) {
          tokens.push(token);
        }

        // If this the wrapped native token create a duplicate for native
        if (
          fromBuffer(currency.contract) === Sdk.Common.Addresses.WNative[config.chainId] &&
          nativeCurrency
        ) {
          const totalSupply = nativeTotalSupply ? nativeTotalSupply.toString() : "0";
          const fdv = bn(totalSupply).mul(
            parseUnits(token.usdPrice.toString(), USD_DECIMALS).toString()
          );

          tokens.push({
            ...token,
            contract: Sdk.Common.Addresses.Native[config.chainId],
            metadata: {
              image: nativeCurrency?.metadata?.image
                ? Assets.getResizedImageUrl(nativeCurrency.metadata.image, ImageSize.small)
                : undefined,
            },
            name: nativeCurrency.name,
            symbol: nativeCurrency.symbol,
            decimals: nativeCurrency.decimals,
            totalSupply,
            fdv: {
              "1day": formatUnits(fdv, USD_DECIMALS).toString().replace(/\.0$/, ""),
            },
            fdvChange: {
              "1day": Number(currency.day1_fdv)
                ? _.round(Number(fdv) / Number(currency.day1_fdv), 6)
                : null,
            },
          });
        }
      }
    }

    // If specific contracts passed include contracts we don't track prices for as well
    for (const contract of query.contracts || []) {
      const tokenWithPricingData = tokens.find((token) => token.contract === contract);

      if (!tokenWithPricingData) {
        if (contract === Sdk.Common.Addresses.WNative[config.chainId] && hideWNative) {
          continue;
        }

        const currency = await getCurrency(contract);

        tokens.push({
          contract,
          metadata: {
            image: currency.metadata?.image
              ? Assets.getResizedImageUrl(currency.metadata.image, ImageSize.small)
              : undefined,
          },
          name: currency?.name || null,
          symbol: currency?.symbol || null,
          decimals: currency?.decimals || null,
          totalSupply: currency?.totalSupply ? String(currency.totalSupply) : null,
          volume: null,
          usdPrice: null,
          usdPriceChange: null,
          fdv: null,
          fdvChange: null,
        });
      }
    }

    if (query.sortBy === "1DayFdvChange") {
      const isDesc = query.sortDirection === "desc";
      tokens = _.sortBy(tokens, [
        (token) => (_.get(token, "fdvChange.1day") === null && isDesc ? 0 : 1),
        "fdvChange.1day", // Sort by value
      ]);

      if (isDesc) {
        tokens = _.reverse(tokens);
      }
    }

    await redis.set(requestCacheKey, JSON.stringify(tokens), "EX", 60);

    return { tokens };
  },
};
