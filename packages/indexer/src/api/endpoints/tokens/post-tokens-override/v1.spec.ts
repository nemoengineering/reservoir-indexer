process.env.ADMIN_API_KEY = "testing";
jest.mock("@/models/api-keys", () => {
  return {
    ApiKeyManager: {
      getApiKey: () => {
        return { key: process.env.ADMIN_API_KEY };
      },
    },
  };
});
jest.mock("@/jobs/currencies/currencies-fetch-job", () => {
  return {
    addToQueue: () => jest.fn(),
  };
});
jest.mock("@/pubsub/index", () => {
  return {
    PubSub: {
      publish: jest.fn(),
    },
  };
});
import { idb } from "@/common/db";
import { fromBuffer, toBuffer } from "@/common/utils";
import * as Sdk from "@reservoir0x/sdk";
import { postTokensOverrideV1Options } from "./v1";
import { Currencies } from "@/models/currencies";
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("postTokensOverrideV1Options tests", () => {
  // todo type this
  let currencies: any[] = [];

  beforeAll(async () => {
    Sdk.Global.Config.addresses = Sdk.Addresses;
    Sdk.Global.Config.aggregatorSource = "reservoir.tools";

    currencies = await idb.query(
      "SELECT * FROM currencies where total_supply > 0 and metadata = '{}' limit 2"
    );
    expect(currencies.length).toEqual(2);
  });

  it("can override a currency and update the table values", async () => {
    expect(currencies[0]).toBeTruthy();
    expect(currencies[0].metadata.image).toBeFalsy();

    const req = {
      params: {
        token: fromBuffer(currencies[0].contract).toLowerCase(),
      },
      payload: {
        icon: "https://freerangestock.com/sample/118790/currency-and-gold-vector-icon.jpg",
        name: "test-name",
      },
      headers: {
        "x-api-key": process.env.ADMIN_API_KEY,
      },
    };
    const { message } = await (postTokensOverrideV1Options as any).handler(req);
    expect(message).toEqual(
      `token ${req.params.token} updated with ${JSON.stringify(req.payload)}`
    );

    let currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(req.params.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(req.payload.name);
    expect(currency[0].metadata.image).toEqual(req.payload.icon);
    expect(currency[0].metadata.adminImage).toEqual(req.payload.icon);
    expect(currency[0].metadata.adminName).toEqual(req.payload.name);

    // revert the change
    await Currencies.updateCurrency(fromBuffer(currency[0].contract), {
      image: null,
      adminImage: null,
      adminName: null,
    });

    currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(req.params.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(req.payload.name);
    expect(currencies[0].metadata).toEqual({});
  });

  it("can override a currency and update the table values", async () => {
    const req = {
      params: {
        token: fromBuffer(currencies[0].contract).toLowerCase(),
      },
      payload: {
        name: "test-name",
        icon: "https://freerangestock.com/sample/118790/currency-and-gold-vector-icon.jpg",
      } as IPayload,
      headers: {
        "x-api-key": process.env.ADMIN_API_KEY,
      },
    };
    await (postTokensOverrideV1Options as any).handler(req);
    // remove the image
    req.payload.icon = null;
    // revert the name
    req.payload.name = currencies[0].name;
    await (postTokensOverrideV1Options as any).handler(req);

    let currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(req.params.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(currencies[0].name);
    expect(currency[0].name !== "test-name").toBeTruthy();
    expect(currency[0].name === currencies[0].name).toBeTruthy();
    expect(currency[0].metadata).toEqual({ adminName: currencies[0].name });

    // remove adminName
    req.payload.name = null;
    await (postTokensOverrideV1Options as any).handler(req);

    currency = await idb.query("SELECT * FROM currencies where contract = $/contract/", {
      contract: toBuffer(req.params.token),
    });
    expect(currency).toBeTruthy();
    expect(currency[0].name).toEqual(currencies[0].name);
    expect(currency[0].metadata).toEqual({});
  });
});

interface IPayload {
  name?: string | null;
  icon?: string | null;
}
