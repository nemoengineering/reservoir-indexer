import { idb, pgp, ridb } from "@/common/db";
import { bn, fromBuffer, now, toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { config } from "@/config/index";
import cron from "node-cron";
import { redlock } from "@/common/redis";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { format, fromUnixTime, sub } from "date-fns";
import { USD_DECIMALS } from "@/utils/prices";
import _ from "lodash";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";
import { parseUnits } from "@ethersproject/units";

export type UpdateCurrenciesVolumeJobPayload = {
  providers: CurrenciesPriceProvider[];
  timestamp: number;
};

export interface IVolumeTokenPrices {
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  date: number;
  dayVolume: string;
  dayVolumeUSD: number;
  allTimeVolume: string;
  allTimeVolumeUSD: number;
}

export default class UpdateCurrenciesVolumeJob extends AbstractRabbitMqJobHandler {
  queueName = "update-currencies-volume";
  maxRetries = 10;
  concurrency = 1;

  getPreviousDayTimestamps(timestamp: number) {
    const previousDay = sub(fromUnixTime(timestamp).setUTCHours(0, 0, 0, 0), { days: 1 });
    const previousDayBeginningTimestamp = Math.floor(previousDay.getTime() / 1000);
    return { previousDay, previousDayBeginningTimestamp };
  }

  async getTokens(provider: CurrenciesPriceProvider) {
    return await ridb.manyOrNone(
      `
        SELECT contract
        FROM currencies_pricing_provider
        WHERE provider = $/provider/
      `,
      { provider }
    );
  }

  public async process(payload: UpdateCurrenciesVolumeJobPayload) {
    const { providers, timestamp } = payload;

    const providerTokenPrices: IVolumeTokenPrices[][] = [];
    for (const provider of providers) {
      providerTokenPrices.push(await this.saveProviderVolumes(provider, timestamp));
    }

    const sumPrices = this.sumTokenPrices(providerTokenPrices);
    await this.updateTokenAggregatedVolumes(providers, sumPrices);
  }

  public sumTokenPrices(providerTokenPrices: IVolumeTokenPrices[][]) {
    // This is run for v2 and v3, however, will sum for both. This is done so that any token not shared still gets the sum
    const tokenMap = new Map<string, IVolumeTokenPrices>();
    providerTokenPrices.map((tokens) => {
      tokens.map((token) => {
        if (!tokenMap.has(token.contract)) {
          tokenMap.set(token.contract, token);
        } else {
          const item = tokenMap.get(token.contract) as IVolumeTokenPrices;
          item.dayVolume = bn(token.dayVolume).add(item.dayVolume).toString();
          item.dayVolumeUSD += token.dayVolumeUSD;
          item.allTimeVolume = bn(token.allTimeVolume).add(item.allTimeVolume).toString();
          item.allTimeVolumeUSD += token.allTimeVolumeUSD;
        }
      });
    });

    return Array.from(tokenMap.values());
  }

  public async saveProviderVolumes(provider: CurrenciesPriceProvider, timestamp: number) {
    // Get all tokens we track prices for the given provider
    const { previousDayBeginningTimestamp } = this.getPreviousDayTimestamps(timestamp);
    const tokens = await this.getTokens(provider);
    let tokensPrices: IVolumeTokenPrices[] = [];
    if (tokens.length) {
      const tokensContracts = tokens.map((token) => fromBuffer(token.contract));

      switch (provider) {
        case CurrenciesPriceProvider.UNISWAP_V3:
          tokensPrices = await this.fetchUniswapV3Volumes(
            tokensContracts,
            previousDayBeginningTimestamp
          );
          break;
        case CurrenciesPriceProvider.UNISWAP_V2:
          tokensPrices = await this.fetchUniswapV2Volumes(
            tokensContracts,
            previousDayBeginningTimestamp
          );
          break;
      }
      await this.recordTokenVolumes(provider, tokensPrices, previousDayBeginningTimestamp);
    }
    return tokensPrices;
  }

  public async fetchUniswapV3Volumes(tokens: string[], date: number) {
    // Chunk tokens to batch of 100s as this is the max tokens we can fetch price info for from the graph in single call
    return (
      await Promise.all(
        _.chunk(tokens, 100).map((tokensChunk) =>
          UniswapSubgraphV3.getTokensVolumesByDate(tokensChunk, date)
        )
      )
    ).flat();
  }

  public async fetchUniswapV2Volumes(tokens: string[], date: number) {
    // Chunk tokens to batch of 100s as this is the max tokens we can fetch price info for from the graph in single call
    return (
      await Promise.all(
        _.chunk(tokens, 100).map((tokensChunk) =>
          UniswapSubgraphV2.getTokensVolumesByDate(tokensChunk, date)
        )
      )
    ).flat();
  }

  public async recordTokenVolumes(
    provider: CurrenciesPriceProvider,
    tokensPrices: IVolumeTokenPrices[],
    timestamp: number
  ) {
    const queries = [];

    const usdPricesDailyColumns = new pgp.helpers.ColumnSet(
      ["currency", "timestamp", "provider", "volume", "volume_usd"],
      {
        table: "usd_prices",
      }
    );

    queries.push(`
      UPDATE usd_prices
      SET volume = x.volume::NUMERIC(78, 0), volume_usd = x.volume_usd::NUMERIC(78, 0)
      FROM (
        VALUES ${pgp.helpers.values(
          tokensPrices.map((token) => ({
            currency: toBuffer(token.contract),
            timestamp: format(fromUnixTime(timestamp), "yyyy-MM-dd 00:00:00"),
            provider,
            volume: token.dayVolume,
            volume_usd: parseUnits(
              token.dayVolumeUSD.toFixed(USD_DECIMALS),
              USD_DECIMALS
            ).toString(),
          })),
          usdPricesDailyColumns
        )}
      ) AS x(currency, timestamp, provider, volume, volume_usd)
      WHERE usd_prices.currency = x.currency::BYTEA
      AND usd_prices.timestamp = x.timestamp::TIMESTAMPTZ
      AND usd_prices.provider = x.provider 
    `);

    if (queries.length) {
      await idb.none(pgp.helpers.concat(queries));
    }
  }

  public async updateTokenAggregatedVolumes(
    providers: string[],
    tokensPrices: IVolumeTokenPrices[]
  ) {
    // Update 1/7/30 days volumes
    const query = `
      WITH volume_data AS (
        SELECT
          currency,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '2 days' THEN volume ELSE 0 END) AS day1_volume,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '8 days' THEN volume ELSE 0 END) AS day7_volume,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '31 days' THEN volume ELSE 0 END) AS day30_volume,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '2 days' THEN volume_usd ELSE 0 END) AS day1_volume_usd,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '8 days' THEN volume_usd ELSE 0 END) AS day7_volume_usd,
          SUM(CASE WHEN "timestamp" > now() - INTERVAL '31 days' THEN volume_usd ELSE 0 END) AS day30_volume_usd
        FROM usd_prices
        WHERE provider IN($/providers:list/)
        AND timestamp > now() - INTERVAL '31 days' 
        GROUP BY currency
      ) 
      UPDATE currencies 
      SET day1_volume = volume_data.day1_volume,
          day7_volume = volume_data.day7_volume,
          day30_volume = volume_data.day30_volume,
          day1_volume_usd = volume_data.day1_volume_usd,
          day7_volume_usd = volume_data.day7_volume_usd,
          day30_volume_usd = volume_data.day30_volume_usd,
          updated_at = NOW()
      FROM volume_data
      WHERE contract = volume_data.currency
    `;
    await idb.none(query, {
      providers,
    });

    // Update all time volumes
    for (const tokensPrice of tokensPrices) {
      await idb.none(
        `
        UPDATE currencies 
        SET all_time_volume = COALESCE($/allTimeVolume/, all_time_volume),
            all_time_volume_usd = COALESCE($/allTimeVolumeUsd/, all_time_volume_usd),
            day1_fdv = (
              SELECT COALESCE(MIN(value), 0) AS value
                FROM usd_prices
                WHERE timestamp = (CURRENT_DATE - INTERVAL '1 day')::timestamp
                AND currency = $/contract/
                AND provider IN ($/providers:list/)
            ) * currencies.total_supply,
            updated_at = NOW()
        WHERE contract = $/contract/
      `,
        {
          contract: toBuffer(tokensPrice.contract),
          allTimeVolume: Number(tokensPrice.allTimeVolume) ? tokensPrice.allTimeVolume : null,
          allTimeVolumeUsd: tokensPrice.allTimeVolumeUSD
            ? parseUnits(
                tokensPrice.allTimeVolumeUSD.toFixed(USD_DECIMALS),
                USD_DECIMALS
              ).toString()
            : null,
          providers,
        }
      );
    }
  }

  public async addToQueue(params: UpdateCurrenciesVolumeJobPayload) {
    await this.send({ payload: params });
  }
}

export const updateCurrenciesVolumeJob = new UpdateCurrenciesVolumeJob();

if (config.doBackgroundWork && config.enableUpdateTopCurrencies) {
  cron.schedule(
    "15 0 * * *",
    async () =>
      await redlock
        .acquire([updateCurrenciesVolumeJob.getQueue()], 30 * 1000)
        .then(async () => {
          await updateCurrenciesVolumeJob.addToQueue({
            providers: [CurrenciesPriceProvider.UNISWAP_V3, CurrenciesPriceProvider.UNISWAP_V2],
            timestamp: now(),
          });
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
