import { idb, pgp, ridb } from "@/common/db";
import { fromBuffer, now, toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { config } from "@/config/index";
import cron from "node-cron";
import { redlock } from "@/common/redis";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { format, fromUnixTime } from "date-fns";
import { parseUnits } from "@ethersproject/units";
import { USD_DECIMALS } from "@/utils/prices";
import _ from "lodash";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";

export type FetchCurrenciesPriceJobPayload = {
  provider: CurrenciesPriceProvider;
  timestamp: number;
};

export default class FetchCurrenciesPriceJob extends AbstractRabbitMqJobHandler {
  queueName = "fetch-currencies-price";
  maxRetries = 10;
  concurrency = 1;

  public async process(payload: FetchCurrenciesPriceJobPayload) {
    const { provider, timestamp } = payload;
    const roundedMinute = timestamp - (timestamp % 60);
    let tokensPrices: { contract: string; priceUSD: number }[] = [];

    // Get all tokens we track prices for the given provider
    const tokens = await ridb.manyOrNone(
      `
        SELECT contract
        FROM currencies_pricing_provider
        WHERE provider = $/provider/
      `,
      { provider }
    );

    if (tokens.length) {
      const tokensContracts = tokens.map((token) => fromBuffer(token.contract));

      switch (provider) {
        case CurrenciesPriceProvider.UNISWAP_V3:
          tokensPrices = await this.fetchUniswapV3Prices(tokensContracts);
          break;
        case CurrenciesPriceProvider.UNISWAP_V2:
          tokensPrices = await this.fetchUniswapV2Prices(tokensContracts);
          break;
      }

      await this.recordTokenPrices(provider, tokensPrices, roundedMinute);
    }
  }

  public async fetchUniswapV3Prices(tokens: string[]) {
    // Chunk tokens to batch of 100s as this is the max tokens we can fetch price info for from the graph in single call
    const tokensPrices = (
      await Promise.all(
        _.chunk(tokens, 100).map((tokensChunk) =>
          UniswapSubgraphV3.getTokensWithPricingData(tokensChunk, true)
        )
      )
    ).flat();

    return tokensPrices.map((priceData) => ({
      contract: priceData.contract,
      priceUSD: Math.min(priceData.priceUSD, 1000000),
    }));
  }

  public async fetchUniswapV2Prices(tokens: string[]) {
    // Chunk tokens to batch of 100s as this is the max tokens we can fetch price info for from the graph in single call
    const tokensPrices = (
      await Promise.all(
        _.chunk(tokens, 100).map((tokensChunk) =>
          UniswapSubgraphV2.getTokensWithPricingData(tokensChunk, true)
        )
      )
    ).flat();

    return tokensPrices.map((priceData) => ({
      contract: priceData.contract,
      priceUSD: Math.min(priceData.priceUSD, 1000000), // Cap USD price at 1M
    }));
  }

  public async recordTokenPrices(
    provider: CurrenciesPriceProvider,
    tokensPrices: { contract: string; priceUSD: number }[],
    timestamp: number
  ) {
    let filteredTokensPrices = tokensPrices;
    // Alow the job to run for testnet, but filter for mainnet
    if (!config.isTestnet) {
      filteredTokensPrices = tokensPrices.filter((token) => token.priceUSD > 0);
      if (_.isEmpty(filteredTokensPrices)) {
        return;
      }
    }

    const queries = [];

    const usdPricesMinutelyColumns = new pgp.helpers.ColumnSet(
      ["currency", "timestamp", "provider", "value"],
      {
        table: "usd_prices_minutely",
      }
    );

    queries.push(`
      INSERT INTO usd_prices_minutely (currency, timestamp, provider, value)
      VALUES ${pgp.helpers.values(
        filteredTokensPrices.map((token) => ({
          currency: toBuffer(token.contract),
          timestamp: format(fromUnixTime(timestamp), "yyyy-MM-dd HH:mm:00"),
          provider,
          value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
        })),
        usdPricesMinutelyColumns
      )}
      ON CONFLICT DO NOTHING
    `);

    // If end of hour
    if (fromUnixTime(timestamp).getMinutes() === 59) {
      const usdPricesHourlyColumns = new pgp.helpers.ColumnSet(
        ["currency", "timestamp", "provider", "value"],
        {
          table: "usd_prices_hourly",
        }
      );

      queries.push(`
        INSERT INTO usd_prices_hourly (currency, timestamp, provider, value)
        VALUES ${pgp.helpers.values(
          filteredTokensPrices.map((token) => ({
            currency: toBuffer(token.contract),
            timestamp: format(fromUnixTime(timestamp), "yyyy-MM-dd HH:00:00"),
            provider,
            value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
          })),
          usdPricesHourlyColumns
        )}
        ON CONFLICT DO NOTHING
      `);
    }

    // If end of day
    if (fromUnixTime(timestamp).getHours() === 23 && fromUnixTime(timestamp).getMinutes() === 59) {
      const usdPricesDailyColumns = new pgp.helpers.ColumnSet(
        ["currency", "timestamp", "provider", "value"],
        {
          table: "usd_prices",
        }
      );

      queries.push(`
        INSERT INTO usd_prices (currency, timestamp, provider, value)
        VALUES ${pgp.helpers.values(
          filteredTokensPrices.map((token) => ({
            currency: toBuffer(token.contract),
            timestamp: format(fromUnixTime(timestamp), "yyyy-MM-dd 00:00:00"),
            provider,
            value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
          })),
          usdPricesDailyColumns
        )}
        ON CONFLICT (currency, timestamp, provider) DO UPDATE SET value = EXCLUDED.value;
      `);
    }

    if (queries.length) {
      await idb.none(pgp.helpers.concat(queries));
    }
  }

  public async addToQueue(params: FetchCurrenciesPriceJobPayload) {
    await this.send({ payload: params });
  }
}

export const fetchCurrenciesPriceJob = new FetchCurrenciesPriceJob();

if (config.doBackgroundWork) {
  cron.schedule(
    "* * * * *",
    async () =>
      await redlock
        .acquire([fetchCurrenciesPriceJob.getQueue()], 30 * 1000)
        .then(async () => {
          const timestamp = now();
          await fetchCurrenciesPriceJob.addToQueue({
            provider: CurrenciesPriceProvider.UNISWAP_V3,
            timestamp,
          });
          await fetchCurrenciesPriceJob.addToQueue({
            provider: CurrenciesPriceProvider.UNISWAP_V2,
            timestamp,
          });
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
