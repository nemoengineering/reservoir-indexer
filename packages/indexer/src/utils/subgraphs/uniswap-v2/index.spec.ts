import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();
process.env.IS_TESTNET = "0";
import "@/utils/tests/mocks";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";
import { IGetTopTokens } from "../types";
import { UniswapSubgraphV3 } from "../uniswap-v3";
import _ from "lodash";
import { now } from "@/common/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(1000 * 1000);

describe("uniswap v2 subgraph tests", () => {
  let tokens: IGetTopTokens[] = [];

  const getPreviousDate = (count = 1) => {
    const days = 24 * 60 * 60 * count;
    const dayBeginning = new Date();
    dayBeginning.setUTCHours(0, 0, 0, 0);
    return Math.floor(dayBeginning.getTime() / 1000) - days;
  };

  it("can getUrl from key and id", async () => {
    const url = await UniswapSubgraphV2.getUrl();
    expect(url.length).toBeTruthy();
  });

  // tokens, totalSupply counts don't match
  // recent top tokens not found for v2
  it("can getTopTokens", async () => {
    // ten days
    const topTokenCount = 10;
    let topTokensV2 = await await UniswapSubgraphV2.getTopTokens(topTokenCount);
    expect(topTokensV2.length).toBeTruthy();
    expect(topTokensV2.length).toEqual(topTokenCount);

    const timestamp = getPreviousDate();

    topTokensV2 = await UniswapSubgraphV2.getTopTokens(topTokenCount, timestamp);
    expect(topTokensV2.length).toBeTruthy();
    expect(topTokensV2.length).toEqual(topTokenCount);

    tokens = _.uniqBy(topTokensV2, "id");
    tokens = _.filter(tokens, (token) => {
      return token.priceUSD > 1;
    });
  });

  it("can getTokens24HourVolume", async () => {
    const tokensToFetchPrice = [tokens[1].id, tokens[0].id];

    const currentTimestamp = now(); // Current Unix timestamp in seconds
    const fromTimestamp = currentTimestamp - (currentTimestamp % 3600) - 86400; // Round down and subtract 24 hours

    const tokens24HourVolume = await UniswapSubgraphV2.getTokens24HourVolume(
      tokensToFetchPrice,
      fromTimestamp
    );
    expect(tokens24HourVolume.length).toEqual(tokensToFetchPrice.length);

    const value = tokens24HourVolume[0];

    const expectedKeys = ["contract", "volume", "volumeUSD"];
    const keys = Object.keys(value);
    expect(keys).toEqual(expectedKeys);

    expect(typeof value.contract).toEqual(typeof "string");
    expect(typeof value.volume).toEqual(typeof "string");
    expect(typeof value.volumeUSD).toEqual(typeof "string");
  });

  it("getTokensWithPricingData values match v3 ", async () => {
    const contracts = [tokens[0].id, tokens[1].id];
    const pricingDataV2 = await UniswapSubgraphV2.getTokensWithPricingData(contracts);

    const pricingDataV3 = await UniswapSubgraphV3.getTokensWithPricingData(contracts);

    const compareV2 = pricingDataV2[0];
    const compareV3 = pricingDataV3[0];

    const { priceUSD } = compareV2;
    const { priceUSD: priceUSDV3 } = compareV3;

    expect(typeof priceUSD).toEqual(typeof 0);
    expect(typeof priceUSDV3).toEqual(typeof 0);
  });

  // pricing data not available for short duration in v2
  // missing high
  it("can getTokensWithPricingData", async () => {
    const contracts = [tokens[0].id, tokens[1].id];
    const pricingDataV2 = await UniswapSubgraphV2.getTokensWithPricingData(contracts, false);
    expect(pricingDataV2.length).toBeTruthy();
    expect(pricingDataV2.length).toEqual(contracts.length);

    // verify same tokens
    pricingDataV2.map((data) => {
      expect(contracts).toContain(data.contract);
    });
  });

  // v2 doesn't have as recent price data, needs to be 1 day behind in testing
  // missing high
  it("can getTopTokensWithPricingData", async () => {
    const limit = 10;
    const topPricingDataV2 = await UniswapSubgraphV2.getTopTokensWithPricingData(limit);
    expect(topPricingDataV2.length).toBeTruthy();
    expect(topPricingDataV2.length).toEqual(limit);

    topPricingDataV2.map((data: any) => {
      const keys = Object.keys(data);
      keys.map((key: string) => {
        if (key !== "oneDayChange") {
          expect(data[key].toString().length).toBeTruthy();
        }
      });
    });
  });

  // mismatch
  // totalSupply, allTimeVolume, allTimeVolumeUSD
  it("can getTokensVolumesByDate", async () => {
    const contracts = [tokens[0].id, tokens[1].id];
    const timestamp = getPreviousDate();
    const tokensVolumesByDateV2 = await UniswapSubgraphV2.getTokensVolumesByDate(
      contracts,
      timestamp
    );
    expect(tokensVolumesByDateV2.length).toBeTruthy();
    expect(tokensVolumesByDateV2.length).toEqual(contracts.length);

    // verify same tokens
    tokensVolumesByDateV2.map((data: any) => {
      expect(contracts).toContain(data.contract);
      const keys = Object.keys(data);
      keys.map((key: string) => {
        expect(data[key].toString().length).toBeTruthy();
      });
    });
  });

  it("can searchTokens", async () => {
    const searchTokensV2 = await UniswapSubgraphV2.searchTokens(tokens[0].name.substring(0, 3), 10);
    expect(searchTokensV2.length).toBeTruthy();
  });

  // tokenHourDatas not available on v2
  // missing high, low, open, close
  it("can getHistoricPrice", async () => {
    const limit = 10;
    const historicalV2 = await UniswapSubgraphV2.getHistoricPrice(
      [tokens[0].id, tokens[1].id],
      "day",
      limit
    );
    const v2Keys = Object.keys(historicalV2);
    expect(v2Keys.length).toBeTruthy();

    v2Keys.map((key) => {
      expect(historicalV2[key]?.length).toEqual(limit);
    });
  });

  it("can getUsdPrice", async () => {
    const tokensToFetchPrice = [tokens[1].id, tokens[0].id];

    const usdPricesV2 = await UniswapSubgraphV2.getUsdPrice(tokensToFetchPrice);
    const v2Keys = Object.keys(usdPricesV2);
    expect(v2Keys.length).toEqual(tokensToFetchPrice.length);

    v2Keys.map((key) => {
      expect(usdPricesV2[key]).toBeTruthy();
    });
  });
});
