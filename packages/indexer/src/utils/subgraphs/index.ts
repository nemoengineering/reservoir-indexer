import { ridb } from "@/common/db";
import { formatUsd, fromBuffer, toBuffer } from "@/common/utils";
import { USD_DECIMALS } from "@/utils/prices";
import { IGetTokensWithPricingData, IGetUsdPrice } from "./types";
import _ from "lodash";
import { logger } from "@/common/logger";
import { UniswapSubgraphV2 } from "./uniswap-v2";
import { UniswapSubgraphV3 } from "./uniswap-v3";

// NOTE - this method doesn't capture oneDayChange from the db, however, it is not used so it's ok
export const getUsdPricesUniswap = async (
  tokens: string[],
  realtimeData = false
): Promise<IGetUsdPrice> => {
  const prices: IGetUsdPrice = {};

  if (realtimeData) {
    const usdPricesV2 = await UniswapSubgraphV2.getTokensWithPricingData(tokens);
    const usdPricesV3 = await UniswapSubgraphV3.getTokensWithPricingData(tokens);

    const combined = combineTokens(usdPricesV2, usdPricesV3);
    // get the lowest of the two
    [...combined.entries()].map((k) => {
      const values = k[1];
      const id = k[0];
      values.sort((a, b) => a.priceUSD - b.priceUSD);

      prices[id] = {
        priceUSD: values[0].priceUSD,
        oneDayChange: values[0].oneDayChange,
      };
    });
    return prices;
  }

  const bufferCurrency = tokens.map((token: string) => toBuffer(token));
  // we use limit of tokens * 10 to ensure we get enough data for each token to compare v2 and v3
  const tokenPrices = await ridb.manyOrNone(
    `
        WITH top_currencies AS (
        SELECT contract 
        FROM currencies  
        WHERE EXISTS (SELECT 1 FROM usd_prices_minutely WHERE currency = currencies.contract LIMIT 1) and contract in ($/tokensToFetchPrice:list/) 
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
        `,
    {
      tokensToFetchPrice: bufferCurrency,
    }
  );

  tokenPrices.map((price) => {
    const {
      realtime_value_usd_v2,
      realtime_value_usd_v3,
      yesterday_value_usd_v2,
      yesterday_value_usd_v3,
    } = price;

    const realTimeValue = getMinValue(realtime_value_usd_v2, realtime_value_usd_v3);
    const yesterdayValue = getMinValue(yesterday_value_usd_v2, yesterday_value_usd_v3);

    if (realTimeValue.toString().indexOf(".") > -1 || yesterdayValue.toString().indexOf(".") > -1) {
      logger.warn(
        `getUsdPricesUniswap`,
        `${fromBuffer(price.contract)} - prices are not bn - ${realTimeValue} - ${yesterdayValue}`
      );
    }

    // NOTE - some currencies will be < 0, in this case we are setting value to 0
    const priceUSD =
      realTimeValue.toString().indexOf(".") === -1 ? formatUsd(realTimeValue.toString()) : 0;
    const oneDayChange =
      yesterdayValue.toString().indexOf(".") === -1 ? formatUsd(yesterdayValue.toString()) : 0;

    prices[fromBuffer(price.contract)] = {
      priceUSD,
      oneDayChange: oneDayChange ? _.round(priceUSD / oneDayChange, USD_DECIMALS) : null,
    };
  });

  return prices;
};

const getMinValue = (value: string, valueTwo: string) => {
  let min = Math.min(Number(value), Number(valueTwo));
  if (!min) {
    min = Math.max(Number(value), Number(valueTwo));
  }
  return min;
};

const combineTokens = (
  usdPricesV2: IGetTokensWithPricingData[],
  usdPricesV3: IGetTokensWithPricingData[]
) => {
  const combined = new Map<string, IGetTokensWithPricingData[]>();

  usdPricesV2.map((token) => {
    const { contract } = token;
    if (combined.has(contract)) {
      const value = combined.get(contract);
      if (value && token) {
        value.push(token);
        combined.set(contract, value);
      }
    } else {
      if (token) combined.set(contract, [token]);
    }
  });
  usdPricesV3.map((token) => {
    const { contract } = token;
    if (combined.has(contract)) {
      const value = combined.get(contract);
      if (value && token) {
        value.push(token);
        combined.set(contract, value);
      }
    } else {
      if (token) combined.set(contract, [token]);
    }
  });
  return combined;
};
