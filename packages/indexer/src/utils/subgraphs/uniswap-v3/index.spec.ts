import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import "@/utils/tests/mocks";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { IGetTopTokens } from "../types";
import _ from "lodash";
import { now } from "@/common/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.setTimeout(1000 * 1000);

describe("uniswap v3 subgraph tests", () => {
  let tokens: IGetTopTokens[] = [];

  const getPreviousDate = (count = 1) => {
    const days = 24 * 60 * 60 * count;
    const dayBeginning = new Date();
    dayBeginning.setUTCHours(0, 0, 0, 0);
    return Math.floor(dayBeginning.getTime() / 1000) - days;
  };

  it("can getUrl from key and id", async () => {
    const url = await UniswapSubgraphV3.getUrl();
    expect(url.length).toBeTruthy();
  });

  it("can getTopTokens", async () => {
    // ten days
    const topTokenCount = 10;
    let topTokensV3 = await await UniswapSubgraphV3.getTopTokens(topTokenCount);
    expect(topTokensV3.length).toBeTruthy();
    expect(topTokensV3.length).toEqual(topTokenCount);

    const timestamp = getPreviousDate();

    topTokensV3 = await UniswapSubgraphV3.getTopTokens(topTokenCount, timestamp);
    expect(topTokensV3.length).toBeTruthy();
    expect(topTokensV3.length).toEqual(topTokenCount);

    tokens = _.uniqBy(topTokensV3, "id");
    tokens = _.filter(tokens, (token) => {
      return token.priceUSD > 1;
    });
  });

  it("can getTokens24HourVolume", async () => {
    const tokensToFetchPrice = [tokens[1].id, tokens[0].id];

    const currentTimestamp = now(); // Current Unix timestamp in seconds
    const fromTimestamp = currentTimestamp - (currentTimestamp % 3600) - 86400; // Round down and subtract 24 hours

    const tokens24HourVolume = await UniswapSubgraphV3.getTokens24HourVolume(
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

  it("can getTokensWithPricingData", async () => {
    const contracts = [tokens[0].id, tokens[1].id];
    const pricingDataV3 = await UniswapSubgraphV3.getTokensWithPricingData(contracts, false);
    expect(pricingDataV3.length).toBeTruthy();
    expect(pricingDataV3.length).toEqual(contracts.length);

    // verify same tokens
    pricingDataV3.map((data) => {
      expect(contracts).toContain(data.contract);
    });
  });

  it("can getTopTokensWithPricingData", async () => {
    const limit = 10;
    const topPricingDataV3 = await UniswapSubgraphV3.getTopTokensWithPricingData(limit);
    expect(topPricingDataV3.length).toBeTruthy();
    expect(topPricingDataV3.length).toEqual(limit);

    topPricingDataV3.map((data: any) => {
      const keys = Object.keys(data);
      keys.map((key: string) => {
        if (key !== "oneDayChange") {
          expect(data[key].toString().length).toBeTruthy();
        }
      });
    });
  });

  it("can getTokensVolumesByDate", async () => {
    const contracts = [tokens[0].id, tokens[1].id];
    const timestamp = getPreviousDate();
    const tokensVolumesByDateV3 = await UniswapSubgraphV3.getTokensVolumesByDate(
      contracts,
      timestamp
    );
    expect(tokensVolumesByDateV3.length).toBeTruthy();
    expect(tokensVolumesByDateV3.length).toEqual(contracts.length);

    // verify same tokens
    tokensVolumesByDateV3.map((data: any) => {
      expect(contracts).toContain(data.contract);
      const keys = Object.keys(data);
      keys.map((key: string) => {
        expect(data[key].toString().length).toBeTruthy();
      });
    });
  });

  it("can searchTokens", async () => {
    const searchTokensV3 = await UniswapSubgraphV3.searchTokens(tokens[0].name.substring(0, 3), 10);
    expect(searchTokensV3.length).toBeTruthy();
  });

  it("can getHistoricPrice", async () => {
    const limit = 10;
    const historicalV3 = await UniswapSubgraphV3.getHistoricPrice(
      [tokens[0].id, tokens[1].id],
      "day",
      limit
    );
    const v3Keys = Object.keys(historicalV3);
    expect(v3Keys.length).toBeTruthy();

    v3Keys.map((key) => {
      expect(historicalV3[key]?.length).toEqual(limit);
    });
  });

  it("can getUsdPrice", async () => {
    const tokensToFetchPrice = [tokens[1].id, tokens[0].id];

    const usdPricesV3 = await UniswapSubgraphV3.getUsdPrice(tokensToFetchPrice);
    const v3Keys = Object.keys(usdPricesV3);
    expect(v3Keys.length).toEqual(tokensToFetchPrice.length);

    v3Keys.map((key) => {
      expect(usdPricesV3[key]).toBeTruthy();
    });
  });
});
