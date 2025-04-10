/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from "@/common/logger";
import { config } from "@/config/index";

import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { metadataIndexWriteJob } from "@/jobs/metadata-index/metadata-write-job";
import { onchainMetadataProvider } from "@/metadata/providers/onchain-metadata-provider";
import {
  normalizeNftStorageLink,
  RequestWasThrottledError,
  TokenUriNotFoundError,
  TokenUriRequestForbiddenError,
  TokenUriRequestTimeoutError,
} from "@/metadata/providers/utils";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { now, toBuffer } from "@/common/utils";
import { idb } from "@/common/db";

export type OnchainMetadataProcessTokenUriJobPayload = {
  contract: string;
  tokenId: string;
  uri: string;
};

export default class OnchainMetadataProcessTokenUriJob extends AbstractRabbitMqJobHandler {
  queueName = "onchain-metadata-index-process-token-uri-queue";
  maxRetries = 5;
  concurrency = 50;
  timeout = 5 * 60 * 1000;
  backoff = {
    type: "exponential",
    delay: 5000,
  } as BackoffStrategy;
  disableErrorLogs = true;

  public async process(payload: OnchainMetadataProcessTokenUriJobPayload) {
    const { contract, tokenId, uri } = payload;
    const retryCount = Number(this.rabbitMqMessage?.retryCount);

    if (
      [8453].includes(config.chainId) &&
      ["0x36361bc2e4d376120b958432204bde7f24ab9471"].includes(contract)
    ) {
      return;
    }

    const startTimestamp = now();

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      this.queueName,
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Start. contract=${contract}, tokenId=${tokenId}, uri=${uri}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}, retryCount=${retryCount}`,
        payload,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    let fallbackError;

    try {
      const metadata = await onchainMetadataProvider.getTokensMetadata([
        { contract, tokenId, uri },
      ]);

      if (metadata.length) {
        logger.log(
          config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
          this.queueName,
          JSON.stringify({
            topic: "tokenMetadataIndexing",
            message: `getTokensMetadata. contract=${contract}, tokenId=${tokenId}, uri=${uri}, latency=${
              now() - startTimestamp
            }`,
            payload,
            metadata: JSON.stringify(metadata),
            debugMetadataIndexingCollection:
              config.debugMetadataIndexingCollections.includes(contract),
            latency: now() - startTimestamp,
          })
        );

        const nftStorageLinkMatch = metadata[0].imageUrl?.match(
          /^(http)s?:\/\/(.*?)\.ipfs\.nftstorage\.link\/(.*?)$/
        );

        if (nftStorageLinkMatch) {
          metadata[0].imageUrl = normalizeNftStorageLink(metadata[0].imageUrl!);
        }

        if (metadata[0].metadataOriginalUrl?.startsWith("data:")) {
          metadata[0].metadataOriginalUrl = undefined;
        }

        if (metadata[0].animationOriginalUrl?.startsWith("data:")) {
          metadata[0].animationOriginalUrl = undefined;
        }

        if (metadata[0].mediaUrl?.startsWith("data:")) {
          metadata[0].mediaUrl = undefined;
        }

        if (metadata[0].imageUrl?.startsWith("data:")) {
          if (config.fallbackMetadataIndexingMethod) {
            logger.warn(
              this.queueName,
              JSON.stringify({
                topic: "tokenMetadataIndexing",
                message: `Fallback - Image Encoding. contract=${contract}, tokenId=${tokenId}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}`,
                debugMetadataIndexingCollection:
                  config.debugMetadataIndexingCollections.includes(contract),
              })
            );

            const tokenResult = await idb.oneOrNone(
              `
            SELECT
              tokens.image,
              (tokens.metadata ->> 'image_mime_type')::TEXT AS image_mime_type,
              (tokens.metadata ->> 'image_original_url')::TEXT AS image_original_url
            FROM tokens
            WHERE tokens.contract = $/contract/
              AND tokens.token_id = $/tokenId/
          `,
              {
                contract: toBuffer(contract),
                tokenId,
              }
            );

            if (tokenResult?.image) {
              metadata[0].imageUrl = tokenResult.image;
              metadata[0].imageOriginalUrl = tokenResult.image_original_url;
              metadata[0].imageMimeType = tokenResult.image_mime_type;
            } else {
              metadata[0].imageUrl = null;
              metadata[0].imageOriginalUrl = undefined;
            }

            if (config.fallbackMetadataIndexingMethod === "alchemy") {
              await metadataIndexFetchJob.addToQueue(
                [
                  {
                    kind: "single-token",
                    data: {
                      method: "alchemy",
                      contract,
                      tokenId,
                      collection: contract,
                      isFallback: true,
                    },
                    context: "onchain-fallback-image-encoding",
                  },
                ],
                true,
                60
              );

              await metadataIndexFetchJob.addToQueue(
                [
                  {
                    kind: "single-token",
                    data: {
                      method: "alchemy",
                      contract,
                      tokenId,
                      collection: contract,
                      isFallback: true,
                    },
                    context: "onchain-fallback-image-encoding",
                  },
                ],
                true,
                60 * 5
              );
            }
          } else if (![690, 17069, 666666666].includes(config.chainId)) {
            metadata[0].imageUrl = null;
            metadata[0].imageOriginalUrl = undefined;
          }
        } else if (metadata[0].mediaUrl?.startsWith("data:")) {
          metadata[0].mediaUrl = null;
          metadata[0].animationOriginalUrl = undefined;
        }

        // if missing imageMimeType/mediaMimeTyp
        if (
          (metadata[0].imageUrl && !metadata[0].imageMimeType) ||
          (metadata[0].mediaUrl && !metadata[0].mediaMimeType)
        ) {
          if (config.fallbackMetadataIndexingMethod) {
            logger.warn(
              this.queueName,
              JSON.stringify({
                topic: "tokenMetadataIndexing",
                message: `Fallback - Missing Mime Type. contract=${contract}, tokenId=${tokenId}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}`,
                contract,
                metadata: JSON.stringify(metadata[0]),
                reason: "Missing Mime Type",
                debugMetadataIndexingCollection:
                  config.debugMetadataIndexingCollections.includes(contract),
              })
            );

            // if (metadata[0].imageUrl && !metadata[0].imageMimeType) {
            //   metadata[0].imageUrl = null;
            //   metadata[0].imageOriginalUrl = undefined;
            // }
            //
            // if (metadata[0].mediaUrl && !metadata[0].mediaMimeType) {
            //   metadata[0].mediaUrl = null;
            //   metadata[0].animationOriginalUrl = undefined;
            // }
            //
            // await metadataIndexFetchJob.addToQueue(
            //   [
            //     {
            //       kind: "single-token",
            //       data: {
            //         method: config.fallbackMetadataIndexingMethod,
            //         contract,
            //         tokenId,
            //         collection: contract,
            //         isFallback: true,
            //       },
            //       context: "onchain-fallback-missing-mime-type",
            //     },
            //   ],
            //   true,
            //   30
            // );
          }
        }

        // if the imageMimeType/mediaMimeType is gif
        if (
          !["0x3c3d5e05fb83be9ba9c85c72cfb6a82174eacec2"].includes(contract) &&
          (metadata[0].imageMimeType === "image/gif" || metadata[0].mediaMimeType === "image/gif")
        ) {
          if (config.fallbackMetadataIndexingMethod) {
            logger.warn(
              this.queueName,
              JSON.stringify({
                topic: "tokenMetadataIndexing",
                message: `Fallback - GIF. contract=${contract}, tokenId=${tokenId}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}`,
                contract,
                reason: "GIF",
                debugMetadataIndexingCollection:
                  config.debugMetadataIndexingCollections.includes(contract),
              })
            );
          }
        }

        if (metadata[0].tokenURI?.startsWith("data:")) {
          metadata[0].tokenURI = undefined;
        }

        logger.log(
          config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
          this.queueName,
          JSON.stringify({
            topic: "tokenMetadataIndexing",
            message: `metadataIndexWriteJob. contract=${contract}, tokenId=${tokenId}, uri=${uri}, fallbackMetadataIndexingMethod=${config.fallbackMetadataIndexingMethod}`,
            metadata: JSON.stringify(metadata),
            debugMetadataIndexingCollection:
              config.debugMetadataIndexingCollections.includes(contract),
          })
        );

        await metadataIndexWriteJob.addToQueue(metadata);

        return;
      } else {
        logger.warn(
          this.queueName,
          `No metadata found. contract=${contract}, tokenId=${tokenId}, uri=${uri}`
        );
      }
    } catch (error) {
      if (
        error instanceof RequestWasThrottledError ||
        error instanceof TokenUriRequestTimeoutError ||
        error instanceof TokenUriNotFoundError ||
        error instanceof TokenUriRequestForbiddenError
      ) {
        // if this is the last retry
        if (retryCount < this.maxRetries) {
          throw error; // throw to retry
        }
      }

      fallbackError = `${(error as any).message}`;

      logger.warn(
        this.queueName,
        JSON.stringify({
          topic: "tokenMetadataIndexing",
          message: `Error. contract=${contract}, tokenId=${tokenId}, uri=${uri}, retryCount=${retryCount}, error=${error}, latency=${
            now() - startTimestamp
          }`,
          contract,
          tokenId,
          error: fallbackError,
          latency: now() - startTimestamp,
        })
      );
    }

    if (!config.fallbackMetadataIndexingMethod) {
      logger.log(
        config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
        this.queueName,
        JSON.stringify({
          topic: "tokenMetadataIndexing",
          message: `No Fallback. contract=${contract}, tokenId=${tokenId}, uri=${uri}, error=${fallbackError}`,
          payload,
          debugMetadataIndexingCollection:
            config.debugMetadataIndexingCollections.includes(contract),
        })
      );

      return;
    }

    if (fallbackError === "Invalid URI") {
      logger.info(
        this.queueName,
        JSON.stringify({
          topic: "tokenMetadataIndexing",
          message: `Skip Fallback. contract=${contract}, tokenId=${tokenId}, uri=${uri}`,
          payload,
          debugMetadataIndexingCollection:
            config.debugMetadataIndexingCollections.includes(contract),
        })
      );

      return;
    }

    logger.info(
      this.queueName,
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Fallback - Get Metadata Error. contract=${contract}, tokenId=${tokenId}, uri=${uri}, fallbackMetadataIndexingMethod=${
          config.fallbackMetadataIndexingMethod
        }, latency=${now() - startTimestamp}`,
        payload,
        reason: "Get Metadata Error",
        error: fallbackError,
        retryCount,
        maxRetriesReached: retryCount >= this.maxRetries,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
        latency: now() - startTimestamp,
      })
    );
  }

  public async addToQueue(params: OnchainMetadataProcessTokenUriJobPayload, delay = 0) {
    await this.send({ payload: params }, delay);
  }

  public async addToQueueBulk(params: OnchainMetadataProcessTokenUriJobPayload[]) {
    await this.sendBatch(
      params.map((param) => {
        return { payload: param };
      })
    );
  }
}

export const onchainMetadataProcessTokenUriJob = new OnchainMetadataProcessTokenUriJob();
