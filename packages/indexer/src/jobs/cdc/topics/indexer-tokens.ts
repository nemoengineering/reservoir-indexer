/* eslint-disable @typescript-eslint/no-explicit-any */

import { KafkaEventHandler } from "./KafkaEventHandler";
import {
  WebsocketEventKind,
  WebsocketEventRouter,
} from "@/jobs/websocket-events/websocket-event-router";
import { refreshAsksTokenJob } from "@/jobs/elasticsearch/asks/refresh-asks-token-job";
import { logger } from "@/common/logger";

import { refreshActivitiesTokenJob } from "@/jobs/elasticsearch/activities/refresh-activities-token-job";
import _ from "lodash";
import { ActivitiesTokenCache } from "@/models/activities-token-cache";
import { backfillTokenAsksJob } from "@/jobs/elasticsearch/asks/backfill-token-asks-job";
// import { Collections } from "@/models/collections";
// import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { config } from "@/config/index";
import { recalcOnSaleCountQueueJob } from "@/jobs/collection-updates/recalc-on-sale-count-queue-job";
import { burnedTokenJob } from "@/jobs/token-updates/burned-token-job";
import { add, isAfter } from "date-fns";
import {
  EventKind,
  processTokenEventJob,
} from "@/jobs/elasticsearch/tokens/process-token-event-job";

export class IndexerTokensHandler extends KafkaEventHandler {
  topicName = "indexer.public.tokens";

  protected async handleInsert(payload: any, offset: string): Promise<void> {
    if (!payload.after) {
      return;
    }

    await WebsocketEventRouter({
      eventInfo: {
        before: payload.before,
        after: payload.after,
        trigger: "insert",
        offset: offset,
      },
      eventKind: WebsocketEventKind.TokenEvent,
    });

    await processTokenEventJob.addToQueue([
      {
        kind: EventKind.tokenCreated,
        data: {
          contract: payload.after.contract,
          token_id: payload.after.token_id,
        },
      },
    ]);
  }

  protected async handleUpdate(payload: any, offset: string): Promise<void> {
    if (!payload.after) {
      return;
    }

    const changed = [];

    for (const key in payload.after) {
      const beforeValue = payload.before[key];
      const afterValue = payload.after[key];

      if (beforeValue !== afterValue) {
        changed.push(key);
      }
    }

    await WebsocketEventRouter({
      eventInfo: {
        before: payload.before,
        after: payload.after,
        trigger: "update",
        offset: offset,
      },
      eventKind: WebsocketEventKind.TokenEvent,
    });

    try {
      try {
        // Update the elasticsearch activities token cache
        if (
          changed.some((value) =>
            [
              "name",
              "image",
              "metadata_disabled",
              "image_version",
              "metadata_version",
              "rarity_rank",
              "rarity_score",
            ].includes(value)
          )
        ) {
          await ActivitiesTokenCache.refreshToken(
            payload.after.contract,
            payload.after.token_id,
            payload.after
          );
        }
      } catch (error) {
        logger.error(
          "IndexerTokensHandler",
          JSON.stringify({
            message: `failed to update activities token cache. contract=${payload.after.contract}, tokenId=${payload.after.token_id}, error=${error}`,
            error,
          })
        );
      }

      // Update the elasticsearch activities index
      if (changed.some((value) => ["is_spam", "nsfw_status"].includes(value))) {
        await refreshActivitiesTokenJob.addToQueue(payload.after.contract, payload.after.token_id);
      }

      // Update the elasticsearch asks index
      if (payload.after.floor_sell_id) {
        if (
          changed.some((value) =>
            ["is_flagged", "is_spam", "rarity_rank", "nsfw_status"].includes(value)
          )
        ) {
          await refreshAsksTokenJob.addToQueue(payload.after.contract, payload.after.token_id);
        }

        if (changed.some((value) => ["collection_id"].includes(value))) {
          await backfillTokenAsksJob.addToQueue(
            payload.after.contract,
            payload.after.token_id,
            true,
            true
          );
        }
      }

      // If the token was burned
      if (
        changed.some((value) => ["remaining_supply"].includes(value)) &&
        payload.after.remaining_supply === "0"
      ) {
        await burnedTokenJob.addToQueue([
          { contract: payload.after.contract, tokenId: payload.after.token_id },
        ]);
      }

      // If the token was listed or listing was removed update the onSaleCount
      if (
        payload.after.collection_id &&
        changed.some((value) => ["floor_sell_id"].includes(value)) &&
        (!payload.before.floor_sell_id || !payload.after.floor_sell_id)
      ) {
        await recalcOnSaleCountQueueJob.addToQueue({ collection: payload.after.collection_id });
        await recalcOnSaleCountQueueJob.addToQueue(
          { collection: payload.after.collection_id },
          1000 * 30
        );
      }

      if (isAfter(add(new Date(payload.after.created_at), { minutes: 60 }), Date.now())) {
        const metadataInitializedAtChanged =
          payload.before.metadata_initialized_at !== payload.after.metadata_initialized_at;

        if (metadataInitializedAtChanged && _.random(100) <= 10) {
          const indexedLatency = Math.floor(
            (new Date(payload.after.metadata_indexed_at).getTime() -
              new Date(payload.after.created_at).getTime()) /
              1000
          );

          if (indexedLatency >= 180) {
            logger.warn(
              "token-metadata-latency-metric",
              JSON.stringify({
                topic: "latency-metrics",
                contract: payload.after.contract,
                tokenId: payload.after.token_id,
                indexedLatency,
                initializedLatency: Math.floor(
                  (new Date(payload.after.metadata_initialized_at).getTime() -
                    new Date(payload.after.created_at).getTime()) /
                    1000
                ),
                createdAt: payload.after.created_at,
                indexedAt: payload.after.metadata_indexed_at,
                initializedAt: payload.after.metadata_initialized_at,
              })
            );
          } else {
            logger.info(
              "token-metadata-latency-metric",
              JSON.stringify({
                topic: "latency-metrics",
                contract: payload.after.contract,
                tokenId: payload.after.token_id,
                indexedLatency,
                initializedLatency: Math.floor(
                  (new Date(payload.after.metadata_initialized_at).getTime() -
                    new Date(payload.after.created_at).getTime()) /
                    1000
                ),
                createdAt: payload.after.created_at,
                indexedAt: payload.after.metadata_indexed_at,
                initializedAt: payload.after.metadata_initialized_at,
              })
            );
          }
        }

        if (
          payload.before.image !== null &&
          payload.after.image === null &&
          payload.after.media === null
        ) {
          logger.warn(
            "IndexerTokensHandler",
            JSON.stringify({
              message: `token image missing! contract=${payload.after.contract}, tokenId=${payload.after.token_id}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}`,
              payload,
            })
          );

          if (config.fallbackMetadataIndexingMethod) {
            // const collection = await Collections.getByContractAndTokenId(
            //   payload.after.contract,
            //   payload.after.token_id
            // );
            //
            // await metadataIndexFetchJob.addToQueue(
            //   [
            //     {
            //       kind: "single-token",
            //       data: {
            //         method: config.fallbackMetadataIndexingMethod,
            //         contract: payload.after.contract,
            //         tokenId: payload.after.token_id,
            //         collection: collection?.id || payload.after.contract,
            //       },
            //       context: "IndexerTokensHandler",
            //     },
            //   ],
            //   true,
            //   30
            // );
          }
        }
      }
    } catch (error) {
      logger.error(
        "IndexerTokensHandler",
        JSON.stringify({
          message: `Handle token error. error=${error}`,
          payload,
          error,
        })
      );
    }

    if (changed.some((value) => ["collection_id", "supply", "remaining_supply"].includes(value))) {
      await processTokenEventJob.addToQueue([
        {
          kind: EventKind.tokenUpdated,
          data: {
            contract: payload.after.contract,
            token_id: payload.after.token_id,
          },
        },
      ]);
    }
  }

  protected async handleDelete(): Promise<void> {
    // probably do nothing here
  }
}
