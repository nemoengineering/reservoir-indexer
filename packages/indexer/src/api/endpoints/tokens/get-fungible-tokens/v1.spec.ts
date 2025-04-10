import { Network } from "@reservoir0x/sdk/src/utils";
import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

const CHAIN_ID = Network.AbstractTestnet;
process.env.CHAIN_ID = CHAIN_ID.toString();

jest.mock("@/config/index");
import { getFungibleTokensV1Options } from "./v1";
import { idb } from "@/common/db";
import { fromBuffer } from "@/common/utils";

jest.mock("@/utils/currencies", () => {
  return {
    getCurrency: () =>
      jest.fn(() => {
        "test";
      }),
  };
});

interface IDbToken {
  currency: Buffer;
  priceUSD: string;
  timestamp: string;
}

interface IToken {
  contract: string;
}
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("Update top currencies job test", () => {
  beforeAll(async () => {
    // verify the chain is set to config
  });

  it("has minutely date for v2 and v3", async () => {
    const providersV2 = await idb.query(
      "SELECT * FROM usd_prices_minutely where provider = 'uniswap-v2'"
    );
    expect(providersV2.length).toBeTruthy();
    const providersV3 = await idb.query(
      "SELECT * FROM usd_prices_minutely where provider = 'uniswap-v3'"
    );
    expect(providersV3.length).toBeTruthy();

    const dupes = [];
    providersV2.map((prov2: IDbToken) => {
      const found = providersV3.find((prov3: IDbToken) => {
        return fromBuffer(prov3.currency) === fromBuffer(prov2.currency);
      });
      if (found) {
        dupes.push({
          contract: fromBuffer(prov2.currency),
          v2: { timestamp: prov2.timestamp, priceUsd: prov2.priceUSD },
          v3: { timestamp: found.timestamp, priceUsd: found.priceUSD },
        });
      }
    });
    // todo verify dupes
  });

  it("can get tokens for 24 hour volume without specify contracts v2 and v3", async () => {
    const request = {
      query: {
        sortBy: "24HourVolume",
        limit: 10,
        sortDirection: "asc",
        providers: ["uniswap-v2", "uniswap-v3"],
      },
      url: {
        search: "",
      },
    };
    const tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });

  it("can get tokens for 1 day volume without specify contracts v2 and v3", async () => {
    const request = {
      query: {
        sortBy: "1DayVolume",
        limit: 10,
        sortDirection: "asc",
        providers: ["uniswap-v2", "uniswap-v3"],
      },
      url: {
        search: "",
      },
    };
    const tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });

  it("can get tokens for 7 day volume without specify contracts v3", async () => {
    const request = {
      query: {
        sortBy: "7DayVolume",
        limit: 10,
        sortDirection: "asc",
        providers: ["uniswap-v3"],
      },
      url: {
        search: "",
      },
    };
    const tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });

  it("can get tokens for 7 day volume without specify contracts v2", async () => {
    const request = {
      query: {
        sortBy: "7DayVolume",
        limit: 10,
        sortDirection: "asc",
        providers: ["uniswap-v2"],
      },
      url: {
        search: "",
      },
    };
    const tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });

  it("can get tokens for 30 day volume without specify contracts", async () => {
    const request = {
      query: {
        sortBy: "30DayVolume",
        limit: 10,
        sortDirection: "asc",
      },
      url: {
        search: "",
      },
    };
    await (getFungibleTokensV1Options as any).handler(request);
    // expect(tokens.tokens.length).toBeTruthy()
  });

  it("can get tokens for 1 day volume with specify contracts", async () => {
    const request = {
      query: {
        sortBy: "1DayVolume",
        limit: 10,
        sortDirection: "asc",
        contracts: null,
      },
      url: {
        search: "",
      },
    };
    let tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();

    const contracts = tokens.tokens.map((token: IToken) => {
      return token.contract;
    });

    request.query.contracts = contracts;
    tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });

  it("can get tokens for 24 hour volume with specify contracts", async () => {
    const request = {
      query: {
        sortBy: "24HourVolume",
        limit: 10,
        sortDirection: "asc",
        contracts: null,
      },
      url: {
        search: "",
      },
    };
    let tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();

    const contracts = tokens.tokens.map((token: IToken) => {
      return token.contract;
    });

    request.query.contracts = contracts;
    tokens = await (getFungibleTokensV1Options as any).handler(request);
    expect(tokens.tokens.length).toBeTruthy();
  });
});
