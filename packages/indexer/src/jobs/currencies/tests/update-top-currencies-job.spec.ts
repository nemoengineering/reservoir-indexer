import "@/utils/tests/mocks";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { idb } from "@/common/db";
import { insertTopCurrencies } from "@/utils/tests/mocks";

describe("UpdateTopCurrenciesJob test", () => {
  it("can getUrl from key and id v2", async () => {
    const url = await UniswapSubgraphV2.getUrl();
    expect(url.length).toBeTruthy();
  });

  it("can getUrl from key and id v3", async () => {
    const url = await UniswapSubgraphV3.getUrl();
    expect(url.length).toBeTruthy();
  });

  it("can process empty payload", async () => {
    await insertTopCurrencies();

    const currencies = await idb.query("SELECT * FROM currencies");
    expect(currencies.length).toBeTruthy();

    const providers = await idb.query("SELECT * FROM currencies_pricing_provider");
    expect(providers.length).toBeTruthy();
  });

  it("can process 10 days timestamp payload", async () => {
    const days = 24 * 60 * 60 * 2;
    await insertTopCurrencies(days);

    const currencies = await idb.query("SELECT * FROM currencies");
    expect(currencies.length).toBeTruthy();

    const providers = await idb.query("SELECT * FROM currencies_pricing_provider");
    expect(providers.length).toBeTruthy();

    const filtersV2 = providers.filter(
      (item: { provider: string }) => item.provider === "uniswap-v2"
    );
    expect(filtersV2.length).toBeTruthy();

    const filtersV3 = providers.filter(
      (item: { provider: string }) => item.provider === "uniswap-v3"
    );
    expect(filtersV3.length).toBeTruthy();
  });
});
