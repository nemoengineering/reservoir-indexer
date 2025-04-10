import "@/utils/tests/mocks";
import UpdateCurrenciesVolumeJob, { IVolumeTokenPrices } from "../update-currencies-volume-job";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { fromBuffer } from "@/common/utils";
import { idb } from "@/common/db";
import { format, fromUnixTime } from "date-fns";

jest.setTimeout(1000 * 60 * 10);

describe("UpdateCurrenciesVolumeJob test", () => {
  const updateCurrenciesVolumeJob = new UpdateCurrenciesVolumeJob();
  const payload = {
    providers: [CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2],
    timestamp: new Date().getTime() / 1000,
  };

  it("can recordTokenVolumes for v2", async () => {
    const { previousDayBeginningTimestamp } = updateCurrenciesVolumeJob.getPreviousDayTimestamps(
      payload.timestamp
    );
    const tokens = await updateCurrenciesVolumeJob.getTokens(CurrenciesPriceProvider.UNISWAP_V2);
    const tokensContracts = tokens.map((token) => fromBuffer(token.contract));
    const tokensPrices = await updateCurrenciesVolumeJob.fetchUniswapV2Volumes(
      tokensContracts,
      previousDayBeginningTimestamp
    );
    await updateCurrenciesVolumeJob.recordTokenVolumes(
      CurrenciesPriceProvider.UNISWAP_V2,
      tokensPrices,
      previousDayBeginningTimestamp
    );
    const timestamp = format(fromUnixTime(payload.timestamp), "yyyy-MM-dd 00:00:00");
    const updatedVolumes = await idb.query(
      `SELECT * FROM usd_prices where provider = 'uniswap-v2' and volume <> 0 and timestamp >= '${timestamp}'`
    );
    expect(updatedVolumes.length).toBeTruthy();
  });

  it("can recordTokenVolumes for v3", async () => {
    const { previousDayBeginningTimestamp } = updateCurrenciesVolumeJob.getPreviousDayTimestamps(
      payload.timestamp
    );
    const tokens = await updateCurrenciesVolumeJob.getTokens(CurrenciesPriceProvider.UNISWAP_V3);
    const tokensContracts = tokens.map((token) => fromBuffer(token.contract));
    const tokensPrices = await updateCurrenciesVolumeJob.fetchUniswapV3Volumes(
      tokensContracts,
      previousDayBeginningTimestamp
    );
    await updateCurrenciesVolumeJob.recordTokenVolumes(
      CurrenciesPriceProvider.UNISWAP_V3,
      tokensPrices,
      previousDayBeginningTimestamp
    );
    expect(tokens).toBeTruthy();

    const timestamp = format(fromUnixTime(payload.timestamp), "yyyy-MM-dd 00:00:00");
    const updatedVolumes = await idb.query(
      `SELECT * FROM usd_prices where provider = 'uniswap-v3' and volume <> 0 and timestamp >= '${timestamp}'`
    );
    expect(updatedVolumes.length).toBeTruthy();
  });

  it("can updateTokenAggregatedVolumes for v2", async () => {
    const timestamp = format(fromUnixTime(payload.timestamp), "yyyy-MM-dd HH:MM:00");
    const { previousDayBeginningTimestamp } = updateCurrenciesVolumeJob.getPreviousDayTimestamps(
      payload.timestamp
    );
    const { providers } = payload;
    const tokens = await updateCurrenciesVolumeJob.getTokens(CurrenciesPriceProvider.UNISWAP_V2);
    const tokensContracts = tokens.map((token) => fromBuffer(token.contract));
    const tokensPrices = await updateCurrenciesVolumeJob.fetchUniswapV2Volumes(
      tokensContracts,
      previousDayBeginningTimestamp
    );

    await updateCurrenciesVolumeJob.updateTokenAggregatedVolumes(providers, tokensPrices);
    const updatedVolumes = await idb.query(
      `SELECT * FROM currencies where day1_volume <> 0 and updated_at >= '${timestamp}'`
    );
    expect(updatedVolumes.length).toBeTruthy();
  });

  it("can sumTokenPrices for v2 and v3", async () => {
    const providerTokenPrices: IVolumeTokenPrices[][] = [];
    for (const provider of payload.providers) {
      providerTokenPrices.push(
        await updateCurrenciesVolumeJob.saveProviderVolumes(provider, payload.timestamp)
      );
    }

    const sumPrices = updateCurrenciesVolumeJob.sumTokenPrices(providerTokenPrices);
    expect(sumPrices.length).toBeTruthy();
  });

  it("can process for v2 and v3", async () => {
    await updateCurrenciesVolumeJob.process(payload);
  });
});
