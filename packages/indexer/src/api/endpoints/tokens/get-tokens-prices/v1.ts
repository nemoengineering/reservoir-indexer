/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { formatUsd, regex, toBuffer } from "@/common/utils";
import _ from "lodash";
import { ridb } from "@/common/db";
import { CurrenciesPriceProvider } from "@/utils/currencies";

const version = "v1";

export const getTokensPricesV1Options: RouteOptions = {
  description: "Tokens Prices",
  notes: "Get for the given token contract historic prices by day/hour",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      contract: Joi.string()
        .lowercase()
        .pattern(regex.address)
        .required()
        .description(
          "Filter to a particular token contract. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
        ),
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
      period: Joi.string().valid("1h", "1d", "7d", "30d", "1y", "all").default("1d"),
      provider: Joi.alternatives()
        .try(Joi.string(), Joi.array())
        .valid(..._.values(CurrenciesPriceProvider))
        .default([CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2])
        .allow(null),
    }),
  },
  response: {
    schema: Joi.object({
      prices: Joi.array().items(
        Joi.object({
          startTimestamp: Joi.number().unsafe(),
          endTimestamp: Joi.number().unsafe(),
          priceUSD: Joi.number(),
        })
      ),
    }).label(`getTokensPrices${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-tokens-prices-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;
    const prices: { startTimestamp: number; endTimestamp: number; priceUSD: number }[] = [];

    if (!query.provider) {
      query.provider = [CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2];
    }

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
    const usdPrices = await ridb.oneOrNone(
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
        tokensToFetchPrice: [query.contract].map((token: string) => toBuffer(token)),
        providers: query.provider,
      }
    );

    if (usdPrices) {
      const processedTimestamps: number[] = [];

      // sort the json array and let the timestamp filter out the higher values
      usdPrices.price_data.sort((a: any, b: any) => {
        if (a.startTimestamp === b.startTimestamp) {
          return a.value - b.value;
        }
        return a.startTimestamp - b.startTimestamp;
      });

      for (const priceData of usdPrices.price_data) {
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

        prices.push({
          startTimestamp,
          endTimestamp: startTimestamp + periodLength,
          priceUSD: Number(priceData.value) ? formatUsd(priceData.value) : 0,
        });
      }
    }

    return { prices: _.orderBy(prices, "startTimestamp", "desc") };
  },
};
