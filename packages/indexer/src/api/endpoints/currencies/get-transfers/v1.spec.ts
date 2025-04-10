import { generateRandomString, getRandomInt, insertUsdPricesMinutely } from "@/utils/tests/mocks";
import { idb } from "@/common/db";
import { bn, fromBuffer, toBuffer } from "@/common/utils";
import { getTransfersV1Options } from "./v1";
import * as Sdk from "@reservoir0x/sdk";
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("getTransfersV1Options tests", () => {
  const timestamp = Number((new Date().getTime() / 1000).toFixed(0));
  const transfers = 200;

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

  afterAll(async () => {
    // await idb.none(`Delete from ft_transfer_events where timestamp = $/timestamp/`, { timestamp });
  });

  it("can get data for single hash", async () => {
    const providersV2 = await idb.query(
      `
        SELECT distinct(contract), c.decimals, upm.value, upm.provider FROM currencies as c
        inner join usd_prices_minutely as upm on c.contract = upm.currency
        where value > 0 and provider = 'uniswap-v2' 
        limit 10
      `
    );
    expect(providersV2.length).toBeTruthy();
    const providersV3 = await idb.query(
      `
        SELECT distinct(contract), c.decimals, upm.value, upm.provider FROM currencies as c
        inner join usd_prices_minutely as upm on c.contract = upm.currency
        where value > 0 and provider = 'uniswap-v3' 
        limit 10
    `
    );
    expect(providersV3.length).toBeTruthy();

    const min = 0;
    const maxV2 = providersV2.length - 1;
    const maxV3 = providersV3.length - 1;

    const from = "0xE515bC3145ae9e944bD94605D57f23543e7";
    const to = "0xE515bC3145ae9e944bD94605D57f23543e7";
    const amount = 1;
    const tx_hash = "0x8d50f90919a72d175420924b6918b659a23bddbb6306a4f92b955bda0e4";
    const block_hash = "0x8d50f90919a72d175420924b6918b659a23bddbb6306a4f92b955bda0e4";
    let block = 66019443;

    // should probably bulk insert

    for (let i = 0; i < transfers; i++) {
      const random = getRandomInt(0, 2);
      const token =
        random == 1 ? providersV2[getRandomInt(min, maxV2)] : providersV3[getRandomInt(min, maxV3)];
      const address = token.contract;
      const decimals = token.decimals;
      await idb.none(
        `INSERT INTO ft_transfer_events ("address", "block_hash", "from", "to", "amount", "tx_hash", "timestamp", "block", "log_index", "tx_index") 
              VALUES ($/address/, $/block_hash/, $/from/, $/to/, $/amount/, $/tx_hash/, $/timestamp/, $/block/, $/log_index/, $/tx_index/)`,
        {
          address,
          block_hash: toBuffer(block_hash + generateRandomString(5)),
          from: toBuffer(from + generateRandomString(5)),
          to: toBuffer(to + generateRandomString(5)),
          amount: Number(bn(amount).pow(decimals).toString()),
          tx_hash: toBuffer(tx_hash + generateRandomString(5)),
          timestamp: timestamp - 30,
          block: block++,
          log_index: getRandomInt(0, 10000),
          tx_index: getRandomInt(0, 10000),
        }
      );
    }

    const found = await idb.query(
      `SELECT tx_hash FROM ft_transfer_events order by timestamp desc limit ${transfers}`
    );
    expect(found.length).toBeTruthy();

    const requestHash = fromBuffer(found[getRandomInt(min, transfers)].tx_hash);
    const request = {
      query: {
        txHash: requestHash,
      },
    };
    const result = await (getTransfersV1Options as any).handler(request);
    expect(result.transfers.length).toEqual(1);

    const { token, txHash, amount: transferAmount } = result.transfers[0];
    const { contract, decimals, name, symbol, totalSupply } = token;
    expect(contract.length).toBeTruthy();
    expect(decimals).toBeTruthy();
    expect(name.length).toBeTruthy();
    expect(symbol.length).toBeTruthy();
    expect(totalSupply.length).toBeTruthy();

    expect(txHash).toEqual(requestHash);

    const { decimal, raw, usd } = transferAmount;
    expect(decimal).toBeDefined();
    expect(raw).toEqual(bn(amount).pow(decimals).toString());
    expect(usd).toBeTruthy();
  });

  it("can get multiple results for hash array", async () => {
    const found = await idb.query("SELECT tx_hash FROM ft_transfer_events limit 50");
    expect(found.length).toBeTruthy();

    const request = {
      query: {
        txHash: [
          fromBuffer(found[0].tx_hash),
          fromBuffer(found[10].tx_hash),
          fromBuffer(found[20].tx_hash),
          fromBuffer(found[30].tx_hash),
          fromBuffer(found[40].tx_hash),
        ],
      },
    };

    const result = await (getTransfersV1Options as any).handler(request);
    expect(result.transfers.length).toEqual(request.query.txHash.length);
  });

  it("can get 100 results for undefined hash", async () => {
    const result = await (getTransfersV1Options as any).handler({ query: {} });
    expect(result.transfers.length).toEqual(100);
  });
});
