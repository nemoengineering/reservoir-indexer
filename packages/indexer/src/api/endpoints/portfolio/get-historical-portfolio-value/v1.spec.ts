import { getWallet, insertUsdPricesMinutely } from "@/utils/tests/mocks";
import { getHistoricalPortfolioValueV1Options } from "./v1";
import * as Sdk from "@reservoir0x/sdk";
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("getHistoricalPortfolioValueV1Options tests", () => {
  const timestamp = Number((new Date().getTime() / 1000).toFixed(0));

  beforeAll(async () => {
    Sdk.Global.Config.addresses = Sdk.Addresses;
    Sdk.Global.Config.aggregatorSource = "reservoir.tools";

    // insert usd_prices_minutely
    const iterations = 1;
    // convert to seconds, subtract minutes for past data, not accurate, just so we have data for testing
    const startTime = timestamp - 60 * iterations;
    await insertUsdPricesMinutely("uniswap-v2", startTime, iterations);
    await insertUsdPricesMinutely("uniswap-v3", startTime, iterations);
  });

  it("can get getHistoricalPortfolioValueV1Options for an unknown wallet", async () => {
    const request = {
      query: {
        granularity: "minute",
        wallet: "0xE515bC3145ae9e944bD94605D57f23543e7B226B",
        period: "1h",
      },
    };

    const result = await (getHistoricalPortfolioValueV1Options as any).handler(request);
    expect(result.portfolio.length).toBeFalsy();
  });

  it("can get getHistoricalPortfolioValueV1Options for a wallet", async () => {
    const request = {
      query: {
        granularity: "minute",
        wallet: getWallet(),
        period: "1h",
      },
    };

    const result = await (getHistoricalPortfolioValueV1Options as any).handler(request);
    expect(result.portfolio.length).toBeTruthy();

    const { startTimestamp, endTimestamp, totalUsdValue } = result.portfolio[0];
    expect(startTimestamp).toBeTruthy();
    expect(endTimestamp).toBeTruthy();
    expect(totalUsdValue).toBeTruthy();
  });
});
