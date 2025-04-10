import { idb, pgp } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { config } from "@/config/index";
import cron from "node-cron";
import { redlock } from "@/common/redis";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { logger } from "@/common/logger";
import { IGetTopTokens } from "@/utils/subgraphs/types";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";

export type UpdateTopCurrenciesJobPayload = {
  dayBeginningTimestamp?: number;
};

export default class UpdateTopCurrenciesJob extends AbstractRabbitMqJobHandler {
  queueName = "update-top-currencies";
  maxRetries = 10;
  concurrency = 1;

  async saveToDatabase(tokens: IGetTopTokens[], provider: CurrenciesPriceProvider) {
    if (tokens.length) {
      const currenciesColumns = new pgp.helpers.ColumnSet(
        ["contract", "name", "symbol", "decimals", "total_supply", "metadata"],
        {
          table: "currencies",
        }
      );

      // Filter any tokens with no USD value (For non testnets only)
      if (!config.isTestnet) {
        tokens = tokens.filter((token) => token.priceUSD > 0);
      }

      const queries = [];

      // Insert into currencies query
      queries.push(`
        INSERT INTO currencies (contract, name, symbol, decimals, total_supply, metadata)
        VALUES ${pgp.helpers.values(
          tokens.map((token) => ({
            contract: toBuffer(token.id),
            name: token.name,
            symbol: token.symbol,
            decimals: token.decimals,
            total_supply: token.totalSupply,
            metadata: {},
          })),
          currenciesColumns
        )}
        ON CONFLICT (contract) DO NOTHING
      `);

      const currenciesPricingProviderColumns = new pgp.helpers.ColumnSet(
        ["contract", "provider", "metadata"],
        {
          table: "currencies_pricing_provider",
        }
      );

      // Insert into currencies_pricing_provider query
      queries.push(`
        INSERT INTO currencies_pricing_provider (contract, provider, metadata)
        VALUES ${pgp.helpers.values(
          tokens.map((token) => ({
            contract: toBuffer(token.id),
            provider,
            metadata: {},
          })),
          currenciesPricingProviderColumns
        )}
        ON CONFLICT DO NOTHING
      `);

      await idb.none(pgp.helpers.concat(queries));
    }
  }

  public async process(payload: UpdateTopCurrenciesJobPayload) {
    logger.info(this.queueName, `Start`);
    const { dayBeginningTimestamp } = payload;

    const tokensV2 = await UniswapSubgraphV2.getTopTokens(1000, dayBeginningTimestamp);
    const tokensV3 = await UniswapSubgraphV3.getTopTokens(1000, dayBeginningTimestamp);

    await this.saveToDatabase(tokensV2, CurrenciesPriceProvider.UNISWAP_V2);
    await this.saveToDatabase(tokensV3, CurrenciesPriceProvider.UNISWAP_V3);
  }

  public async addToQueue(params: UpdateTopCurrenciesJobPayload) {
    await this.send({ payload: params });
  }
}

export const updateTopCurrenciesJob = new UpdateTopCurrenciesJob();

if (config.doBackgroundWork && config.enableUpdateTopCurrencies) {
  cron.schedule(
    config.updateTopCurrenciesSchedule ?? "30 23 * * *",
    async () =>
      await redlock
        .acquire(["update-top-currencies"], 60 * 1000)
        .then(async () => {
          await updateTopCurrenciesJob.addToQueue({});
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
