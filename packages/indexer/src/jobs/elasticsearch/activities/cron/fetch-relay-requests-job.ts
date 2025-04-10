/* eslint-disable @typescript-eslint/no-explicit-any */

import cron from "node-cron";

import { logger } from "@/common/logger";
import { redis, redlock } from "@/common/redis";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import axios from "axios";

import {
  EventKind as ProcessActivityEventKind,
  processActivityEventJob,
  ProcessActivityEventJobPayload,
} from "@/jobs/elasticsearch/activities/process-activity-event-job";

import { RelayRequestProcessedInfo } from "@/elasticsearch/indexes/activities/event-handlers/base";

export default class FetchRelayRequestsJob extends AbstractRabbitMqJobHandler {
  queueName = "fetch-relay-requests-job";
  maxRetries = 5;
  concurrency = 1;
  singleActiveConsumer = true;

  public async process() {
    let relayRequests = [];

    try {
      let url = `https://api.${
        config.isTestnet ? "testnets." : ""
      }relay.link/requests/v2?limit=50&sortBy=updatedAt&chainId=${
        config.chainId
      }&privateChainsToInclude=${config.chainId}`;

      const cacheKey = "fetch-relay-requests-cursor";
      const cursor = await redis.get(cacheKey);

      let cursorType = "startTimestamp";
      let cursorValue = `${Math.floor(new Date().getTime() / 1000)}`;

      if (cursor) {
        const cursorParts = cursor.split(":");

        cursorType = cursorParts[0];
        cursorValue = cursorParts[1];
      }

      if (cursorType == "continuation") {
        url = `${url}&continuation=${cursorValue}`;
      } else {
        url = `${url}&startTimestamp=${cursorValue}`;
      }

      const relayRequestsResponse = await axios.get(url);

      relayRequests = relayRequestsResponse.data.requests.filter(
        (request: any) =>
          request.status === "success" &&
          request.data.metadata.currencyIn &&
          request.data.metadata.currencyOut &&
          request.data.metadata.currencyIn.currency.chainId !==
            request.data.metadata.currencyOut.currency.chainId
      );

      logger.debug(
        this.queueName,
        JSON.stringify({
          message: `Relay Response. url=${url}, cursorType=${cursorType}, cursorValue=${cursorValue},  relayRequestsResponse=${relayRequestsResponse.data.requests.length}, relayRequests=${relayRequests.length}`,
          nextContinuation: JSON.stringify(relayRequestsResponse.data.continuation),
        })
      );

      if (relayRequestsResponse.data.continuation) {
        await redis.set(cacheKey, `continuation:${relayRequestsResponse.data.continuation}`);

        await fetchRelayRequestsJob.addToQueue(5);
      } else if (cursorType == "startTimestamp") {
        await redis.set(cacheKey, `startTimestamp:${cursorValue}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error(
        this.queueName,
        `fetchRelayRequests request failed. error=${JSON.stringify(error)}`
      );
    }

    if (relayRequests.length) {
      await processActivityEventJob.addToQueue(
        relayRequests.map(
          (relayRequest: any) =>
            ({
              kind: ProcessActivityEventKind.relayRequestProcessed,
              data: relayRequest as RelayRequestProcessedInfo,
            } as ProcessActivityEventJobPayload)
        )
      );
    }
  }

  public async addToQueue(delay = 0) {
    if (!config.enableElasticsearchFtActivities) {
      return;
    }

    await this.send({}, delay * 1000);
  }
}

export const fetchRelayRequestsJob = new FetchRelayRequestsJob();

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork && config.enableElasticsearchFtActivities) {
  cron.schedule(
    `*/30 * * * * *`,
    async () =>
      await redlock
        .acquire([`fetch-relay-requests-job-lock`], (30 - 1) * 1000)
        .then(async () => fetchRelayRequestsJob.addToQueue())
        .catch(() => {
          // Skip on any errors
        })
  );
}
