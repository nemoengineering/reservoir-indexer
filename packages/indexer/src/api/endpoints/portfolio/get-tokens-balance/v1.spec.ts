import { getWallet, insertBalances } from "@/utils/tests/mocks";
import { idb, redb } from "@/common/db";
import { fromBuffer, toBuffer } from "@/common/utils";
import * as Sdk from "@reservoir0x/sdk";
import { getUsdPricesUniswap } from "@/utils/subgraphs";
import { getTokensBalanceV1Options } from "./v1";
import _ from "lodash";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("Get portfolio value", () => {
  const wallet = getWallet();

  beforeAll(async () => {
    Sdk.Global.Config.addresses = Sdk.Addresses;
    Sdk.Global.Config.aggregatorSource = "reservoir.tools";
  });

  it("can get portfolio for v2 and v3 tokens", async () => {
    const providersV2 = await idb.query(
      `
        SELECT distinct(contract), c.decimals, upm.value, upm.provider FROM currencies as c
        inner join usd_prices_minutely as upm on c.contract = upm.currency
        where value > 0 and provider = 'uniswap-v2' 
        limit 2
      `
    );
    expect(providersV2.length).toBeTruthy();
    const providersV3 = await idb.query(
      `
        SELECT distinct(contract), c.decimals, upm.value, upm.provider FROM currencies as c
        inner join usd_prices_minutely as upm on c.contract = upm.currency
        where value > 0 and provider = 'uniswap-v3' 
        limit 2
    `
    );
    expect(providersV3.length).toBeTruthy();

    const tokens = providersV2.concat(providersV3);

    await insertBalances(tokens);

    const conditions: string[] = [];
    conditions.push(`ft.owner = $/wallet/`);
    conditions.push(`ft.amount > 0`);

    const baseQuery = `
                SELECT *
                FROM ft_balances ft
                WHERE ${conditions.map((c) => `(${c})`).join(" AND ")}
              `;

    const tokensResult = await redb.manyOrNone(baseQuery, { wallet: toBuffer(wallet) });
    expect(tokensResult.length).toBeTruthy();

    let contracts = tokens.map((token: any) => fromBuffer(token.contract));
    contracts = _.uniq(contracts).sort();
    const usdPrices = await getUsdPricesUniswap(contracts);
    const keys = Object.keys(usdPrices).sort();
    expect(contracts).toEqual(keys);
    keys.map((key) => {
      expect(usdPrices[key]?.priceUSD).toBeTruthy();
    });

    const result = await (getTokensBalanceV1Options as any).handler({
      query: { wallet: wallet.toLowerCase(), limit: 10 },
    });
    expect(result.tokens).toBeDefined();
    expect(result.tokens.length).toBeTruthy();
    expect(result.tokens[0].usdPrice).toBeTruthy();
    expect(result.tokens[0].usdValue).toBeTruthy();
  });
});
