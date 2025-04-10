/* eslint-disable @typescript-eslint/no-explicit-any */

import { HashZero } from "@ethersproject/constants";
import { Common } from "@reservoir0x/sdk";
import { Queue, QueueScheduler, Worker } from "bullmq";

import { idb } from "@/common/db";
import { logger } from "@/common/logger";
import { baseProvider } from "@/common/provider";
import { redis } from "@/common/redis";
import { fromBuffer, now, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { orderUpdatesByMakerJob } from "@/jobs/order-updates/order-updates-by-maker-job";

const QUEUE_NAME = "backfill-wrong-ft-balances";

const updateFtBalance = async (token: string, owner: string) => {
  const erc20 = new Common.Helpers.Erc20(baseProvider, token);
  const balance = await erc20.getBalance(owner).then((b) => b.toString());
  await idb.none(
    `
      INSERT INTO ft_balances (
        contract,
        owner,
        amount
      ) VALUES (
        $/contract/,
        $/owner/,
        $/amount/
      )
      ON CONFLICT (contract, owner)
      DO UPDATE SET
        amount = $/amount/,
        updated_at = now()
    `,
    {
      contract: toBuffer(token),
      owner: toBuffer(owner),
      amount: balance,
    }
  );
};

export const queue = new Queue(QUEUE_NAME, {
  connection: redis.duplicate(),
  defaultJobOptions: {
    attempts: 10,
    removeOnComplete: 1000,
    removeOnFail: 10000,
  },
});
new QueueScheduler(QUEUE_NAME, { connection: redis.duplicate() });

const RUN_NUMBER = 1;

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { fromBlock, toBlock } = job.data;

      const results = await idb.manyOrNone(
        `
          SELECT
            ft_transfer_events."address",
            ft_transfer_events."from",
            ft_transfer_events."to"
          FROM ft_transfer_events
          WHERE ft_transfer_events.block = $/block/
        `,
        {
          block: toBlock,
        }
      );

      if (results.length) {
        await Promise.all(
          results.map(async (r) => {
            const address = fromBuffer(r.address);
            const from = fromBuffer(r.from);
            const to = fromBuffer(r.to);

            {
              const lockKey = `${QUEUE_NAME}:${address}-${from}`;
              const lock = await redis.get(lockKey);
              if (!lock) {
                await updateFtBalance(address, from);
                await redis.set(lockKey, "1", "EX", 3600);
              }
            }

            {
              const lockKey = `${QUEUE_NAME}:${address}-${to}`;
              const lock = await redis.get(lockKey);
              if (!lock) {
                await updateFtBalance(address, to);
                await redis.set(lockKey, "1", "EX", 3600);
              }
            }

            await orderUpdatesByMakerJob.addToQueue([
              {
                context: `revalidation-${address}-${from}`,
                maker: from,
                trigger: {
                  kind: "revalidation",
                  txHash: HashZero,
                  txTimestamp: now(),
                },
                data: {
                  kind: "buy-balance",
                  contract: address,
                },
              },
              {
                context: `revalidation-${address}-${to}`,
                maker: to,
                trigger: {
                  kind: "revalidation",
                  txHash: HashZero,
                  txTimestamp: now(),
                },
                data: {
                  kind: "buy-balance",
                  contract: address,
                },
              },
            ]);
          })
        );
      }

      if (toBlock > fromBlock) {
        await addToQueue(fromBlock, toBlock - 1);
      }
    },
    { connection: redis.duplicate(), concurrency: 1 }
  );

  worker.on("error", (error) => {
    logger.error(QUEUE_NAME, `Worker errored: ${error}`);
  });
}

export const addToQueue = async (fromBlock: number, toBlock: number) => {
  const id = `${toBlock}-${RUN_NUMBER}`;
  await queue.add(id, { fromBlock, toBlock }, { jobId: id });
};
