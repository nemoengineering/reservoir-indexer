import { redb } from "@/common/db";
import {
  getWallet,
  insertFtBalances,
  insertTopCurrencies,
  insertUsdPricesMinutely,
} from "@/utils/tests/mocks";
import { fromBuffer, toBuffer } from "@/common/utils";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { getUsdPricesUniswap } from "@/utils/subgraphs/index";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";
import _ from "lodash";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(1000 * 60 * 10);

// WARNING - this test will write data to db, only run against localhost

describe("Get portfolio value", () => {
  const tokensToFetchPrice: string[] = [];
  const wallet = getWallet();

  const populateTokensFromDb = async () => {
    const conditions: string[] = [];
    conditions.push(`ftb.owner = $/wallet/`);
    conditions.push(`ftb.amount > 0`);
    const baseQuery = `
    with count as (with mixed as (SELECT ftb.contract
                FROM ft_balances ftb
                inner join currencies_pricing_provider cpp 
                on ftb.contract = cpp.contract 
                where cpp.provider in ('uniswap-v3','uniswap-v2') AND ${conditions
                  .map((c) => `(${c})`)
                  .join(" AND ")} )
                select count(contract) as "found", contract from mixed  
                group by contract)
                select * from count 
                inner join usd_prices_minutely as upm on count.contract = upm.currency
                where upm.value > 0 and count.found = 2
                order by value desc limit 1 
              `;
    const tokensResult = await redb.manyOrNone(baseQuery, { wallet: toBuffer(wallet) });
    for (const token of tokensResult) {
      tokensToFetchPrice.push(fromBuffer(token.contract));
    }
  };

  beforeAll(async () => {
    // insert currencies, will grab 1000 from v2 and 1000 from v3
    await insertTopCurrencies();

    // insert ft_balances for v2 and v3 top tokens
    const topTokenCount = 10;
    let topTokensV2 = await await UniswapSubgraphV2.getTopTokens(topTokenCount);
    topTokensV2 = _.uniqBy(topTokensV2, "id");
    topTokensV2 = _.filter(topTokensV2, (token) => {
      return token.priceUSD > 0;
    });
    let topTokensV3 = await await UniswapSubgraphV3.getTopTokens(topTokenCount);
    topTokensV3 = _.uniqBy(topTokensV2, "id");
    topTokensV3 = _.filter(topTokensV3, (token) => {
      return token.priceUSD > 0;
    });
    const unique = _.uniqBy(topTokensV2.concat(topTokensV3), "id");
    await insertFtBalances(unique, wallet);

    // populate tokens for tests
    await populateTokensFromDb();

    // insert usd_prices_minutely
    const iterations = 1;
    // convert to seconds, subtract minutes for past data, not accurate, just so we have data for testing
    const startTime = Number((new Date().getTime() / 1000).toFixed(0)) - 60 * iterations;
    await insertUsdPricesMinutely("uniswap-v2", startTime, iterations);
    await insertUsdPricesMinutely("uniswap-v3", startTime, iterations);
  });

  it("can getUsdPricesUniswap from db to match cached min of v2 and v3 getTokensWithPricingData", async () => {
    const token = [tokensToFetchPrice[0]];

    const v2Price = (await UniswapSubgraphV2.getTokensWithPricingData(token))[0];
    const v3Price = (await UniswapSubgraphV3.getTokensWithPricingData(token))[0];
    const dbPrices = await getUsdPricesUniswap(token);
    const dbPrice = dbPrices[token[0]];
    expect(v3Price).toBeTruthy();
    expect(v2Price).toBeTruthy();
    expect(dbPrice).toBeTruthy();

    expect(dbPrice?.priceUSD).toBeTruthy();
    expect(v2Price?.priceUSD).toBeTruthy();
    expect(v3Price?.priceUSD).toBeTruthy();

    expect(dbPrice?.oneDayChange).toBeDefined();

    const minValue = Math.min(v2Price?.priceUSD as number, v3Price?.priceUSD as number);
    expect(Number(minValue.toFixed(5))).toEqual(dbPrice?.priceUSD);
  });

  it("can getUsdPricesUniswap realtime min of v2 and v3 getTokensWithPricingData", async () => {
    const token = [tokensToFetchPrice[0]];
    const realtimePrices = await getUsdPricesUniswap(token, true);
    const realtimePrice = realtimePrices[token[0]];

    const usdPricesV2 = await UniswapSubgraphV2.getTokensWithPricingData(token);
    const usdPricesV3 = await UniswapSubgraphV3.getTokensWithPricingData(token);

    expect(realtimePrice).toBeTruthy();
    expect(realtimePrice?.priceUSD).toBeTruthy();
    expect(realtimePrice?.oneDayChange).toBeTruthy();

    const minValue = Math.min(usdPricesV2[0].priceUSD as number, usdPricesV3[0].priceUSD as number);
    expect(minValue).toEqual(realtimePrice?.priceUSD);
  });
});
