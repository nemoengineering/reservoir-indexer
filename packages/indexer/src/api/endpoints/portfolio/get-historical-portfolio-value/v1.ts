/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { toBuffer, fromBuffer, formatPrice, formatUsd } from "@/common/utils";
import { redb, ridb } from "@/common/db";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import _ from "lodash";
import { CurrenciesPriceProvider, getCurrency } from "@/utils/currencies";
import { FtBalances } from "@/models/ft-balances";

const version = "v1";

export const getHistoricalPortfolioValueV1Options: RouteOptions = {
  cache: {
    privacy: "public",
    expiresIn: 60000,
  },
  description: "Historical Portfolio Value",
  notes: "Get for the given wallet its historical portfolio value",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      wallet: Joi.string()
        .lowercase()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
      period: Joi.string().valid("1h", "1d", "7d", "30d", "1y", "all").default("1d"),
      granularity: Joi.string()
        .description("Return results by either minute/hour/day granularity")
        .when("period", {
          is: Joi.valid("1y", "all"),
          then: Joi.valid("day").default("day"),
          otherwise: Joi.when("period", {
            is: Joi.valid("7d", "30d"),
            then: Joi.valid("hour", "day").default("day"),
            otherwise: Joi.when("period", {
              is: "1d",
              then: Joi.valid("minute", "hour").default("hour"),
              otherwise: Joi.when("period", {
                is: "1h",
                then: Joi.valid("minute").default("minute"),
              }),
            }),
          }),
        }),
      provider: Joi.alternatives()
        .try(Joi.string(), Joi.array())
        .valid(..._.values(CurrenciesPriceProvider))
        .default([CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2])
        .allow(null),
    }),
  },
  response: {
    schema: Joi.object({
      portfolio: Joi.array().items(
        Joi.object({
          startTimestamp: Joi.number().unsafe(),
          endTimestamp: Joi.number().unsafe(),
          totalUsdValue: Joi.number(),
        })
      ),
    }).label(`getHistoricalPortfolioValue${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(
        `get-historical-portfolio-value-${version}-handler`,
        `Wrong response schema: ${error}`
      );
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    if (!query.provider) {
      query.provider = [CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2];
    }

    const nativeBalance = await FtBalances.getNativeBalance(query.wallet);

    const portfolio: { startTimestamp: number; endTimestamp: number; totalUsdValue: number }[] = [];
    (query as any).wallet = toBuffer(query.wallet);

    // Filters
    const conditions: string[] = [];
    conditions.push(`ft.owner = $/wallet/`);
    conditions.push(`ft.amount > 0`);

    let interval = "";
    switch (query.period) {
      case "1h":
        interval = "1 hour";
        break;

      case "1d":
        interval = "1 day";
        break;

      case "7d":
        interval = "7 days";
        break;

      case "30d":
        interval = "30 days";
        break;

      case "1y":
        interval = "1 year";
        break;
    }

    const baseQuery = `
        SELECT ft.*, c.decimals
        FROM ft_balances ft
        JOIN currencies c ON ft.contract = c.contract 
        WHERE ${conditions.map((c) => `(${c})`).join(" AND ")}
      `;

    const tokensBalances = await redb.manyOrNone(baseQuery, { ...query });

    // If user has no tokens
    if (_.isEmpty(tokensBalances) && nativeBalance.eq(0)) {
      return { portfolio: [] };
    }

    // Build array with only relevant tokens
    const tokensToFetchPrice = [Sdk.Common.Addresses.WNative[config.chainId]];
    for (const token of tokensBalances) {
      if (!tokensToFetchPrice.includes(fromBuffer(token.contract))) {
        tokensToFetchPrice.push(fromBuffer(token.contract));
      }
    }

    let pricesTable = "usd_prices";
    let periodLength = 60 * 60 * 24 - 1;
    switch (query.granularity) {
      case "minute":
        pricesTable = "usd_prices_minutely";
        periodLength = 60 - 1;
        break;

      case "hour":
        pricesTable = "usd_prices_hourly";
        periodLength = 60 * 60 - 1;
        break;
    }

    // Get prices for relevant tokens in each period
    // this will query for the values in usd_prices_minutely or usd_prices_hourly, then prepends the lowest usd_prices_minutely from v2 or v3
    const usdPrices = await ridb.manyOrNone(
      `
        WITH x AS (
          SELECT currency,
                 array_agg(json_build_object('startDate', timestamp, 'startTimestamp', EXTRACT(EPOCH FROM timestamp), 'value', value)) AS "price_data"
          FROM ${pricesTable}
          WHERE currency IN ($/tokensToFetchPrice:csv/)
          ${interval ? `AND timestamp >= NOW() - INTERVAL '${interval}'` : ""}
          AND provider IN ($/providers:list/)
          GROUP BY currency 
        )        
        -- Add the realtime value to the price data
        SELECT x.currency,
               array_prepend(json_build_object('startDate', y.timestamp, 'startTimestamp', EXTRACT(EPOCH FROM y.timestamp), 'value', y.value), x.price_data) AS "price_data"
        FROM x
        JOIN LATERAL (
          SELECT MIN(usd_prices_minutely."value") AS value, timestamp 
          FROM usd_prices_minutely
          WHERE currency = x.currency 
          GROUP BY value, timestamp
          ORDER BY timestamp DESC
          LIMIT 1
        ) y ON TRUE
      `,
      {
        tokensToFetchPrice: tokensToFetchPrice.map((token: string) => toBuffer(token)),
        providers: query.provider,
      }
    );

    // Build price object for each token
    if (usdPrices.length) {
      const historicUsdPrices: {
        [key: string]:
          | {
              startTimestamp: number;
              endTimestamp: number;
              priceUSD: number;
            }[]
          | null;
      } = {};

      for (const usdPrice of usdPrices) {
        const processedTimestamps: number[] = [];

        // sort the json array and let the timestamp filter out the higher values
        usdPrice.price_data.sort((a: any, b: any) => {
          if (a.startTimestamp === b.startTimestamp) {
            return a.value - b.value;
          }
          return a.startTimestamp - b.startTimestamp;
        });

        for (const priceData of usdPrice.price_data) {
          const startData = new Date(priceData.startDate);
          if (query.granularity === "hour") {
            startData.setMinutes(0, 0, 0);
          } else if (query.granularity === "day") {
            startData.setHours(0, 0, 0, 0);
          }

          // Handle any duplicates that can occur in the last minute of an hour
          const startTimestamp = startData.getTime() / 1000;
          if (processedTimestamps.includes(startTimestamp)) {
            continue;
          }

          processedTimestamps.push(startTimestamp);
          if (!_.has(historicUsdPrices, fromBuffer(usdPrice.currency))) {
            historicUsdPrices[fromBuffer(usdPrice.currency)] = [];
          }

          historicUsdPrices[fromBuffer(usdPrice.currency)]!.push({
            startTimestamp,
            endTimestamp: startTimestamp + periodLength,
            priceUSD: Number(priceData.value) ? formatUsd(priceData.value) : 0,
          });
        }
      }

      const tokensData: { [key: string]: { usdValue: number; endTimestamp: number } } = {};

      // Check for native currency balance
      if (nativeBalance.gt(0)) {
        const nativeCurrency = await getCurrency(Sdk.Common.Addresses.Native[config.chainId]);

        tokensBalances.push({
          contract: toBuffer(Sdk.Common.Addresses.WNative[config.chainId]),
          decimals: nativeCurrency.decimals,
          amount: nativeBalance.toString(),
        });
      }

      if (tokensBalances.length) {
        // If the user has any tokens
        for (const token of tokensBalances) {
          if (_.has(historicUsdPrices, fromBuffer(token.contract))) {
            _.map(historicUsdPrices[fromBuffer(token.contract)], (prices) => {
              // initialize the object
              if (!_.has(tokensData, prices.startTimestamp)) {
                tokensData[prices.startTimestamp] = { usdValue: 0, endTimestamp: 0 };
              }

              const balance = formatPrice(token.amount, token.decimals);
              tokensData[prices.startTimestamp].usdValue =
                prices.priceUSD * balance + (tokensData[prices.startTimestamp]?.usdValue ?? 0);
              tokensData[prices.startTimestamp].endTimestamp = prices.endTimestamp;
            });
          }
        }
      }

      if (!_.isEmpty(tokensData)) {
        for (const [startTimestamp, tokenData] of Object.entries(tokensData)) {
          portfolio.push({
            startTimestamp: Number(startTimestamp),
            endTimestamp: Number(tokenData.endTimestamp),
            totalUsdValue: Number(tokenData.usdValue.toFixed(6)),
          });
        }
      }
    }

    return { portfolio: _.orderBy(portfolio, "startTimestamp", "desc") };
  },
};
