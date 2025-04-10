import { logger } from "@/common/logger";

import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";

import { backfillActivitiesElasticsearchJob } from "@/jobs/elasticsearch/activities/backfill/backfill-activities-elasticsearch-job";
import { backfillTokensElasticsearchJob } from "@/jobs/elasticsearch/tokens/backfill-tokens-elasticsearch-job";
import { backfillAsksElasticsearchJob } from "@/jobs/elasticsearch/asks/backfill-asks-elasticsearch-job";
import { backfillCollectionsElasticsearchJob } from "@/jobs/elasticsearch/collections/backfill-collections-elasticsearch-job";
import { config } from "@/config/index";

export class BackfillElasticsearchJob extends AbstractRabbitMqJobHandler {
  queueName = "backfill-elasticsearch-queue";
  maxRetries = 10;
  concurrency = 5;
  persistent = true;

  public async process(payload: BackfillElasticsearchJobPayload) {
    logger.info(
      this.queueName,
      JSON.stringify({
        topic: "backfillElasticsearch",
        message: `Start.`,
        payload,
      })
    );

    if (payload.backfillActivities) {
      const bacfillFtActivities = config.enableElasticsearchFtActivities;

      await backfillActivitiesElasticsearchJob.addToQueue(
        payload.clusterUrl,
        payload.clusterUsername,
        payload.clusterPassword,
        payload.activitiesIndexName,
        payload.keepGoing,
        true,
        true,
        true,
        true,
        true,
        true,
        bacfillFtActivities,
        bacfillFtActivities,
        undefined,
        undefined,
        undefined,
        "DESC"
      );
    }

    if (payload.backfillAsks) {
      await backfillAsksElasticsearchJob.addToQueue(
        payload.asksIndexName,
        payload.clusterUrl,
        payload.clusterUsername,
        payload.clusterPassword,
        payload.keepGoing
      );
    }

    if (payload.backfillCollections) {
      await backfillCollectionsElasticsearchJob.addToQueue(
        payload.collectionsIndexName,
        payload.clusterUrl,
        payload.clusterUsername,
        payload.clusterPassword,
        payload.keepGoing
      );
    }

    if (payload.backfillTokens) {
      await backfillTokensElasticsearchJob.addToQueue(
        payload.tokensIndexName,
        payload.clusterUrl,
        payload.clusterUsername,
        payload.clusterPassword,
        payload.keepGoing
      );
    }
  }
}

export const backfillElasticsearchJob = new BackfillElasticsearchJob();

export type BackfillElasticsearchJobPayload = {
  backfillActivities?: boolean;
  backfillAsks?: boolean;
  backfillCollections?: boolean;
  backfillTokens?: boolean;
  activitiesIndexName?: string;
  asksIndexName?: string;
  collectionsIndexName?: string;
  tokensIndexName?: string;
  clusterUrl?: string;
  clusterUsername?: string;
  clusterPassword?: string;
  keepGoing?: boolean;
};
