import { acquireLock, redis } from "@/common/redis";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { refreshMintsForCollection } from "@/orderbook/mints/calldata";

export type MintsRefreshJobPayload = {
  collection: string;
  forceRefresh?: boolean;
};

export default class MintsRefreshJob extends AbstractRabbitMqJobHandler {
  queueName = "mints-refresh";
  maxRetries = 1;
  concurrency = 10;
  backoff = {
    type: "exponential",
    delay: 10000,
  } as BackoffStrategy;

  public async process(payload: MintsRefreshJobPayload) {
    const { collection, forceRefresh } = payload;

    const lockKey = `mints-refresh-lock:${collection}`;
    if (!(await redis.get(lockKey)) || forceRefresh) {
      await redis.set(lockKey, "locked", "EX", 30 * 60);
      await refreshMintsForCollection(collection);
    }
  }

  public async addToQueue(mintInfo: MintsRefreshJobPayload, delay = 0) {
    await this.send({ payload: mintInfo }, delay * 1000);
  }
}

export const triggerDelayedRefresh = async (collection: string) => {
  const DAY = 86400;
  const timeIntervals = [DAY, DAY * 7, DAY * 31];

  for (const timeInterval of timeIntervals) {
    const acquiredLock = await acquireLock(
      `mint-refresh-lock-delayed:${collection}:${timeInterval}`,
      timeInterval
    );
    if (acquiredLock) {
      await mintsRefreshJob.addToQueue({ collection }, timeInterval);
    }
  }
};

export const mintsRefreshJob = new MintsRefreshJob();
