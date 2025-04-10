import { idb, pgp, ridb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { fromBuffer, toBuffer } from "@/common/utils";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import _ from "lodash";
import { format, fromUnixTime } from "date-fns";
import { parseUnits } from "@ethersproject/units";
import { USD_DECIMALS } from "@/utils/prices";

export class BackfillUniswapV3PricesJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-uniswap-v3-prices";
  maxRetries = 10;
  concurrency = 1;

  public async process(payload: {
    backfillPrices?: boolean;
    backfillVolume?: boolean;
    hours?: number;
    days?: number;
  }) {
    const { backfillPrices, backfillVolume, hours, days } = payload;

    if (backfillPrices) {
      await this.backfillPrices(hours, days);
    }

    if (backfillVolume) {
      await this.backfillVolume(days);
    }
  }

  public async backfillVolume(days?: number) {
    // Get all tokens we track prices for the given provider
    const tokens = await ridb.manyOrNone(
      `
        SELECT contract
        FROM currencies_pricing_provider
        WHERE provider = $/provider/
      `,
      { provider: CurrenciesPriceProvider.UNISWAP_V3 }
    );

    if (tokens.length) {
      for (const batchedTokens of _.chunk(tokens, 100)) {
        const tokensContracts = batchedTokens.map((token) => fromBuffer(token.contract));

        // Backfill daily
        const dailyHistoricPrices = await UniswapSubgraphV3.getHistoricPrice(
          tokensContracts,
          "day",
          _.min([days, 1000]) ?? 1
        );

        const usdPricesDailyColumns = new pgp.helpers.ColumnSet(
          ["currency", "timestamp", "provider", "value", "volume", "volume_usd"],
          {
            table: "usd_prices",
          }
        );

        for (const [tokenContract, tokensPrices] of Object.entries(dailyHistoricPrices)) {
          if (tokensPrices) {
            await idb.none(`
              INSERT INTO usd_prices (currency, timestamp, provider, value, volume, volume_usd)
              VALUES ${pgp.helpers.values(
                tokensPrices.map((token) => ({
                  currency: toBuffer(tokenContract),
                  timestamp: format(fromUnixTime(token.startTimestamp), "yyyy-MM-dd 00:00:00"),
                  provider: CurrenciesPriceProvider.UNISWAP_V3,
                  value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
                  volume: parseUnits(token.volume, token.decimals).toString(),
                  volume_usd: parseUnits(
                    token.volumeUSD.toFixed(USD_DECIMALS),
                    USD_DECIMALS
                  ).toString(),
                })),
                usdPricesDailyColumns
              )}
              ON CONFLICT (currency, timestamp, provider) DO UPDATE SET volume = EXCLUDED.volume, volume_usd = EXCLUDED.volume_usd;
            `);
          }
        }
      }
    }
  }

  public async backfillPrices(hours?: number, days?: number) {
    // Get all tokens we track prices for the given provider
    const tokens = await ridb.manyOrNone(
      `
        SELECT contract
        FROM currencies_pricing_provider
        WHERE provider = $/provider/
      `,
      { provider: CurrenciesPriceProvider.UNISWAP_V3 }
    );

    if (tokens.length) {
      for (const batchedTokens of _.chunk(tokens, 100)) {
        const tokensContracts = batchedTokens.map((token) => fromBuffer(token.contract));

        // Backfill hourly
        const hourlyHistoricPrices = await UniswapSubgraphV3.getHistoricPrice(
          tokensContracts,
          "hour",
          _.min([hours, 41]) ?? 1
        );

        const usdPricesHourlyColumns = new pgp.helpers.ColumnSet(
          ["currency", "timestamp", "provider", "value"],
          {
            table: "usd_prices_hourly",
          }
        );

        for (const [tokenContract, tokensPrices] of Object.entries(hourlyHistoricPrices)) {
          if (tokensPrices) {
            await idb.none(`
              INSERT INTO usd_prices_hourly (currency, timestamp, provider, value)
              VALUES ${pgp.helpers.values(
                tokensPrices.map((token) => ({
                  currency: toBuffer(tokenContract),
                  timestamp: format(fromUnixTime(token.startTimestamp), "yyyy-MM-dd HH:00:00"),
                  provider: CurrenciesPriceProvider.UNISWAP_V3,
                  value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
                })),
                usdPricesHourlyColumns
              )}
              ON CONFLICT DO NOTHING
            `);
          }
        }

        // Backfill daily
        const dailyHistoricPrices = await UniswapSubgraphV3.getHistoricPrice(
          tokensContracts,
          "day",
          _.min([days, 1000]) ?? 1
        );

        const usdPricesDailyColumns = new pgp.helpers.ColumnSet(
          ["currency", "timestamp", "provider", "value"],
          {
            table: "usd_prices",
          }
        );

        for (const [tokenContract, tokensPrices] of Object.entries(dailyHistoricPrices)) {
          if (tokensPrices) {
            await idb.none(`
              INSERT INTO usd_prices (currency, timestamp, provider, value)
              VALUES ${pgp.helpers.values(
                tokensPrices.map((token) => ({
                  currency: toBuffer(tokenContract),
                  timestamp: format(fromUnixTime(token.startTimestamp), "yyyy-MM-dd 00:00:00"),
                  provider: CurrenciesPriceProvider.UNISWAP_V3,
                  value: parseUnits(token.priceUSD.toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
                })),
                usdPricesDailyColumns
              )}
              ON CONFLICT (currency, timestamp, provider) DO UPDATE SET value = EXCLUDED.value;
            `);
          }
        }
      }
    }
  }

  public async addToQueue() {
    await this.send();
  }
}

export const backfillUniswapV3PricesJob = new BackfillUniswapV3PricesJob();
