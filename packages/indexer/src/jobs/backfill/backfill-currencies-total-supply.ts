import { idb, redb } from "@/common/db";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import { logger } from "@/common/logger";
import { redis } from "@/common/redis";
import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { baseProvider } from "@/common/provider";
import { fromBuffer } from "@/common/utils";

export class BackfillCurrenciesTotalSupply extends AbstractRabbitMqJobHandler {
  queueName = "backfill-currencies-total-supply";
  maxRetries = 10;
  concurrency = 1;
  persistent = false;
  lazyMode = false;
  singleActiveConsumer = true;

  public async process() {
    const limit = (await redis.get(`${this.queueName}-limit`)) || 100;

    const results = await redb.manyOrNone(
      `
       SELECT contract FROM currencies WHERE total_supply IS NULL LIMIT $/limit/
          `,
      {
        limit,
      }
    );

    logger.info(
      this.queueName,
      JSON.stringify({
        message: `Updating currencies. results=${results.length}`,
        results,
      })
    );

    for (const result of results) {
      const contract = fromBuffer(result.contract);

      try {
        const iface = new Interface(["function totalSupply() view returns (uint256)"]);
        const _contract = new Contract(contract, iface, baseProvider);

        const totalSupply = (await _contract.totalSupply())?.toString();

        logger.info(
          this.queueName,
          JSON.stringify({
            message: `Updating currency. contract=${contract}, totalSupply=${totalSupply}`,
          })
        );

        await idb.none(
          `
        UPDATE currencies SET
          total_supply = $/totalSupply/,
          updated_at = NOW()
        WHERE contract = $/contract/
      `,
          {
            contract: result.contract,
            totalSupply,
          }
        );
      } catch (error) {
        logger.error(
          this.queueName,
          JSON.stringify({
            message: `Error Updating currency. contract=${contract}`,
            error,
          })
        );
      }
    }

    if (results.length >= limit) {
      return this.addToQueue(1 * 1000);
    }

    logger.info(this.queueName, `Backfill done!`);
  }

  public async addToQueue(delay = 0) {
    await this.send({ payload: {} }, delay);
  }
}

export const backfillCurrenciesTotalSupply = new BackfillCurrenciesTotalSupply();
