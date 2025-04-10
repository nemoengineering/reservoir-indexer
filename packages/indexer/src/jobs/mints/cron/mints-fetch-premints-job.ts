import cron from "node-cron";

import { logger } from "@/common/logger";
import { acquireLock, redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { simulateAndUpsertCollectionPremint } from "@/orderbook/mints";
import {
  convertPremintsToCollectionMint,
  fetchPremints,
  getNetworkName,
} from "@/orderbook/mints/calldata/detector/zora";
import { prepareMetadata } from "@/orderbook/mints/helpers";
import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";

const COMPONENT = "mints-fetch-premints";

export default class MintsFetchPremintsJob extends AbstractRabbitMqJobHandler {
  queueName = COMPONENT;
  maxRetries = 1;
  concurrency = 1;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process() {
    try {
      return;

      const premints = await fetchPremints();

      logger.info(`${COMPONENT}`, JSON.stringify({ message: "Processing premints", premints }));

      const newOrUpdatedPremints = [];

      for (const premint of premints) {
        logger.info(
          `${COMPONENT}`,
          JSON.stringify({
            message: `Processing premint. contract=${premint.contract_address}, tokenId=${premint.premint.uid}, version=${premint.premint.version}`,
            premint,
          })
        );

        const acquiredLock = await acquireLock(
          `${COMPONENT}-lock:${premint.contract_address}:${premint.premint.version}`,
          24 * 3600
        );

        if (acquiredLock) {
          const contractResult = await idb.oneOrNone(
            "SELECT is_offchain FROM contracts WHERE address = $/contract/",
            {
              contract: toBuffer(premint.contract_address),
            }
          );

          if (!contractResult || contractResult.is_offchain) {
            newOrUpdatedPremints.push(premint);
          }
        }
      }

      logger.info(
        `${COMPONENT}`,
        JSON.stringify({ message: "Processing newOrUpdatedPremints", newOrUpdatedPremints })
      );

      const collectionMints = await convertPremintsToCollectionMint(newOrUpdatedPremints);

      await Promise.all(
        collectionMints.map(async (collectionMint, i) => {
          const result = await simulateAndUpsertCollectionPremint(collectionMint, "erc1155");

          logger.info(
            COMPONENT,
            JSON.stringify({
              message: `Processing collectionMint. collection=${collectionMint.collection}, tokenId=${collectionMint.tokenId}`,
              success: result,
              collectionMint,
            })
          );

          if (result) {
            await prepareMetadata(
              collectionMint.contract,
              premints[i].contract_name,
              "erc1155",
              "zora",
              premints[i].premint.uid.toString()
            );
          }
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error(this.queueName, `Failed to sync premints: ${error} (${error.stack})`);
      throw error;
    }
  }

  public async addToQueue(delay = 0) {
    await this.send({}, delay * 1000);
  }
}

export const mintsFetchPremintsJob = new MintsFetchPremintsJob();

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork && getNetworkName(config.chainId)) {
  cron.schedule(
    `*/10 * * * * *`,
    async () =>
      await redlock
        .acquire([`${COMPONENT}-lock`], 10 * 60 * 1000 - 5)
        .then(async () => mintsFetchPremintsJob.addToQueue())
        .catch(() => {
          // Skip on any errors
        })
  );
}
