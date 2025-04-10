import cron from "node-cron";

import { config } from "@/config/index";
import { redlock } from "@/common/redis";
import { idb, pgp, ridb } from "@/common/db";
import { bn, fromBuffer, now, toBuffer } from "@/common/utils";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { UniswapSubgraphV3 } from "@/utils/subgraphs/uniswap-v3";
import { CurrenciesPriceProvider } from "@/utils/currencies";
import { IGetToken24HourVolumeData } from "@/utils/subgraphs/types";
import { logger } from "@/common/logger";
import { UniswapSubgraphV2 } from "@/utils/subgraphs/uniswap-v2";

export type UpdateCurrencies24HourVolumeJobPayload = {
  providers: CurrenciesPriceProvider[];
};

export type UpdateCurrency24HourVolumeData = Record<string, { volume: string; volumeUSD: string }>;

export default class UpdateCurrencies24HourVolumeJob extends AbstractRabbitMqJobHandler {
  queueName = "update-currencies-24hour-volume";
  maxRetries = 10;
  concurrency = 1;

  public async process(payload: UpdateCurrencies24HourVolumeJobPayload) {
    const { providers } = payload;

    const providersTokens24HourVolumeData: IGetToken24HourVolumeData[] = [];

    for (const provider of providers) {
      const providerTokens24HourVolumeData = await this.fetchProvider24HourVolumes(provider);

      logger.info(
        this.queueName,
        JSON.stringify({
          message: `fetchUniswapVolumes. provider=${provider}`,
          providerTokens24HourVolumeData,
        })
      );

      providersTokens24HourVolumeData.push(...(providerTokens24HourVolumeData ?? []));
    }

    if (providersTokens24HourVolumeData.length) {
      const tokens24HourVolumeData = providersTokens24HourVolumeData.reduce((acc, item) => {
        if (!acc[item.contract]) {
          acc[item.contract] = { volume: "0", volumeUSD: "0" };
        }

        acc[item.contract].volume = bn(acc[item.contract].volume).add(bn(item.volume)).toString();
        acc[item.contract].volumeUSD = bn(acc[item.contract].volumeUSD)
          .add(bn(item.volumeUSD))
          .toString();

        return acc;
      }, {} as UpdateCurrency24HourVolumeData);

      await this.updateTokens24HourVolume(tokens24HourVolumeData);
    }
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

  async fetchProvider24HourVolumes(
    provider: CurrenciesPriceProvider
  ): Promise<IGetToken24HourVolumeData[] | undefined> {
    const tokens = await this.getTokens(provider);

    if (tokens.length) {
      let providerTokens24HourVolumeData: IGetToken24HourVolumeData[] = [];

      const contracts = tokens.map((token) => fromBuffer(token.contract));

      const currentTimestamp = now(); // Current Unix timestamp in seconds
      const fromTimestamp = currentTimestamp - (currentTimestamp % 3600) - 86400; // Round down and subtract 24 hours

      switch (provider) {
        case CurrenciesPriceProvider.UNISWAP_V2:
          providerTokens24HourVolumeData = await UniswapSubgraphV2.getTokens24HourVolume(
            contracts,
            fromTimestamp
          );
          break;
        case CurrenciesPriceProvider.UNISWAP_V3:
          providerTokens24HourVolumeData = await UniswapSubgraphV3.getTokens24HourVolume(
            contracts,
            fromTimestamp
          );
          break;
      }

      for (const contract of contracts) {
        if (!providerTokens24HourVolumeData.find((item) => item.contract === contract)) {
          providerTokens24HourVolumeData.push({ contract, volume: "0", volumeUSD: "0" });
        }
      }

      return providerTokens24HourVolumeData;
    }
  }

  async updateTokens24HourVolume(data: UpdateCurrency24HourVolumeData) {
    const queries: {
      query: string;
      values: { contract: Buffer; hour24Volume: string; hour24VolumeUsd: string };
    }[] = [];

    Object.entries(data).forEach(([contract, volumes]) => {
      queries.push({
        query: `
            UPDATE currencies
            SET hour24_volume = $/hour24Volume/,
                hour24_volume_usd = $/hour24VolumeUsd/,
                updated_at = NOW()             
            WHERE contract = $/contract/`,
        values: {
          contract: toBuffer(contract),
          hour24Volume: volumes.volume,
          hour24VolumeUsd: volumes.volumeUSD,
        },
      });
    });

    await idb.none(pgp.helpers.concat(queries));
  }

  public async addToQueue(params: UpdateCurrencies24HourVolumeJobPayload) {
    await this.send({ payload: params });
  }
}

export const updateCurrencies24HourVolumeJob = new UpdateCurrencies24HourVolumeJob();

if (config.doBackgroundWork && config.enableUpdateTopCurrencies) {
  cron.schedule(
    "0 * * * *",
    async () =>
      await redlock
        .acquire([updateCurrencies24HourVolumeJob.getQueue()], 30 * 1000)
        .then(async () => {
          await updateCurrencies24HourVolumeJob.addToQueue({
            providers: [CurrenciesPriceProvider.UNISWAP_V2, CurrenciesPriceProvider.UNISWAP_V3],
          });
        })
        .catch(() => {
          // Skip any errors
        })
  );
}
