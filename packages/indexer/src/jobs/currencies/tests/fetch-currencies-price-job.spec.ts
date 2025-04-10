import "@/utils/tests/mocks";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { idb } from "@/common/db";
import FetchCurrenciesPriceJob, {
  FetchCurrenciesPriceJobPayload,
} from "../fetch-currencies-price-job";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { insertUsdPricesMinutely } from "@/utils/tests/mocks";
import { format, fromUnixTime } from "date-fns";

jest.setTimeout(100000);

describe("FetchCurrenciesPriceJob test", () => {
  const fetchCurrenciesPriceJob = new FetchCurrenciesPriceJob();

  it("can getUrl from key and id v2", async () => {
    const url = await UniswapSubgraphV2.getUrl();
    expect(url.length).toBeTruthy();
  });

  it("can getUrl from key and id v3", async () => {
    const url = await UniswapSubgraphV3.getUrl();
    expect(url.length).toBeTruthy();
  });

  it("can process v2 minutely", async () => {
    // insert usd_prices_minutely
    const iterations = 1;
    // convert to seconds, subtract minutes for past data, not accurate, just so we have data for testing
    const now = new Date().getTime();
    const startTime = Number((now / 1000).toFixed(0));
    await insertUsdPricesMinutely("uniswap-v2", startTime, iterations);
    const prices = await idb.query(
      `SELECT * FROM usd_prices_minutely where provider = 'uniswap-v2' order by timestamp desc limit 1`
    );
    const dbPrice = prices[0];
    expect(dbPrice.timestamp.getMinutes()).toEqual(new Date(now).getMinutes());
    expect(dbPrice.timestamp.getHours()).toEqual(new Date(now).getHours());
  });

  it("can process v3 minutely", async () => {
    // insert usd_prices_minutely
    const iterations = 1;
    // convert to seconds, subtract minutes for past data, not accurate, just so we have data for testing
    const now = new Date().getTime();
    const startTime = Number((now / 1000).toFixed(0));
    await insertUsdPricesMinutely("uniswap-v3", startTime, iterations);
    const prices = await idb.query(
      `SELECT * FROM usd_prices_minutely where provider = 'uniswap-v3' order by timestamp desc limit 1`
    );
    const dbPrice = prices[0];
    expect(dbPrice.timestamp.getMinutes()).toEqual(new Date(now).getMinutes());
    expect(dbPrice.timestamp.getHours()).toEqual(new Date(now).getHours());
  });

  it("can process hourly", async () => {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours() - 1,
      59,
      0
    );
    const timestamp = Number((start.getTime() / 1000).toFixed(0));
    const payload = {
      provider: CurrenciesPriceProvider.UNISWAP_V2,
      timestamp,
    } as FetchCurrenciesPriceJobPayload;
    await fetchCurrenciesPriceJob.process(payload);

    const providers = await idb.query(
      "SELECT * FROM usd_prices_hourly where provider = 'uniswap-v2' order by timestamp desc limit 1"
    );
    const formatTime = format(fromUnixTime(timestamp), "yyyy-MM-dd HH:00:00");
    expect(providers.length).toBeTruthy();
    expect(new Date(formatTime).getTime()).toEqual(providers[0].timestamp.getTime());
  });

  it("can process daily", async () => {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const start = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate(),
      23,
      59,
      0
    );
    const timestamp = Number((start.getTime() / 1000).toFixed(0));
    const payload = {
      provider: CurrenciesPriceProvider.UNISWAP_V2,
      timestamp,
    } as FetchCurrenciesPriceJobPayload;
    await fetchCurrenciesPriceJob.process(payload);

    const providers = await idb.query(
      "SELECT * FROM usd_prices where provider = 'uniswap-v2' order by timestamp desc limit 1"
    );
    const formatTime = format(fromUnixTime(timestamp), "yyyy-MM-dd 00:00:00");
    expect(providers.length).toBeTruthy();
    expect(new Date(formatTime).getTime()).toEqual(providers[0].timestamp.getTime());
  });
});
