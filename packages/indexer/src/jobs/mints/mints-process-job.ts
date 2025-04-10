import { idb } from "@/common/db";
import { logger } from "@/common/logger";
import { acquireLock } from "@/common/redis";
import { fromBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { mintsRefreshJob, triggerDelayedRefresh } from "@/jobs/mints/mints-refresh-job";
import {
  CollectionMint,
  CollectionMintStandard,
  simulateAndUpsertCollectionMint,
} from "@/orderbook/mints";
import * as detector from "@/orderbook/mints/calldata/detector";
import {
  createContractIfInexistent,
  createCollectionIfInexistent,
  createTokenIfInexistent,
} from "@/orderbook/mints/helpers";

export type MintsProcessJobPayload =
  | {
      by: "tx";
      data: {
        txHash: string;
      };
    }
  | {
      by: "collection";
      data: {
        standard: CollectionMintStandard;
        collection: string;
        tokenId?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        additionalInfo?: any;
      };
    }
  | {
      by: "contractMetadata";
      data: {
        collection: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: any;
        deployer?: string | null;
      };
    };

export default class MintsProcessJob extends AbstractRabbitMqJobHandler {
  queueName = "mints-process";
  maxRetries = 3;
  concurrency = 30;

  public async process(payload: MintsProcessJobPayload) {
    const { by, data } = payload;

    try {
      let collectionMints: CollectionMint[] = [];

      // Process new mints knowing the mint configuration in the metadata
      if (by === "contractMetadata") {
        collectionMints = await detector.extractByContractMetadata(
          data.collection,
          data.metadata,
          data.deployer
        );
      }

      // Process new mints knowing a mint transaction
      if (by === "tx") {
        collectionMints = await detector.extractByTx(data.txHash);
      }

      // Process new mints knowing the collection (triggered from a standard-specific on-chain event)
      if (by === "collection") {
        // Make sure the contract exists
        await createContractIfInexistent(data.collection);

        // Make sure the collection exists
        await createCollectionIfInexistent(data.collection, data.standard, data.additionalInfo);

        // Make sure the token exists
        if (data.tokenId) {
          await createTokenIfInexistent(data.collection, data.tokenId, data.standard, false);
        }

        const contractResult = await idb.one(
          `
            SELECT
              contracts.kind,
              collections.contract,
              contracts.metadata,
              contracts.deployer
            FROM collections
            JOIN contracts
              ON collections.contract = contracts.address
            WHERE collections.id = $/collection/
          `,
          {
            collection: data.collection,
          }
        );

        switch (data.standard) {
          case "decent": {
            collectionMints = await detector.decent.extractByCollectionERC721(data.collection);

            break;
          }

          case "foundation": {
            if (data.tokenId) {
              collectionMints = await detector.foundation.extractByCollectionERC1155(
                data.collection,
                data.tokenId
              );
            } else {
              collectionMints = await detector.foundation.extractByCollectionERC721(
                data.collection
              );
            }

            break;
          }

          case "manifold": {
            if (contractResult.kind === "erc721") {
              collectionMints = await detector.manifold.extractByCollectionERC721(
                data.collection,
                data.additionalInfo.instanceId,
                data.additionalInfo.extension
              );
            } else if (contractResult.kind === "erc1155") {
              collectionMints = await detector.manifold.extractByCollectionERC1155(
                data.collection,
                {
                  instanceId: data.additionalInfo.instanceId,
                  extension: data.additionalInfo.extension,
                }
              );
            }

            break;
          }

          case "seadrop-v1.0": {
            collectionMints = await detector.seadrop.extractByCollectionERC721(data.collection);

            break;
          }

          case "thirdweb": {
            if (data.tokenId) {
              collectionMints = await detector.thirdweb.extractByCollectionERC1155(
                data.collection,
                data.tokenId
              );
            } else {
              collectionMints = await detector.thirdweb.extractByCollectionERC721(data.collection);
            }

            break;
          }

          case "zora": {
            if (data.tokenId) {
              collectionMints = await detector.zora.extractByCollectionERC1155(
                data.collection,
                data.tokenId,
                data.additionalInfo?.minter
              );
            } else {
              collectionMints = await detector.zora.extractByCollectionERC721(data.collection);
            }

            break;
          }

          case "createdotfun": {
            collectionMints = await detector.createdotfun.extractByCollectionERC721(
              data.collection
            );
            break;
          }

          case "titlesxyz": {
            collectionMints = await detector.titlesxyz.extractByCollectionERC721(data.collection);
            break;
          }

          case "highlightxyz": {
            collectionMints = await detector.highlightxyz.extractByCollectionERC721(
              data.collection,
              {
                vectorId: data.additionalInfo.vectorId,
              }
            );

            break;
          }

          case "fairxyz": {
            collectionMints = await detector.fairxyz.extractByCollection(
              data.collection,
              data.additionalInfo.editionId
            );
            break;
          }

          case "magiceden": {
            const deployer = contractResult.deployer ? fromBuffer(contractResult.deployer) : "";

            if (
              deployer ||
              [
                "0x000000009e44eba131196847c685f20cd4b68ac4",
                "0x00000000bea935f8315156894aa4a45d3c7a0075",
                "0x4a08d3f6881c4843232efde05bacfb5eaab35d19",
                "0x0000000000000000000000000000000000010000",
              ].includes(deployer)
            ) {
              if (contractResult.kind === "erc721") {
                collectionMints = await detector.magiceden.extractByCollectionERC721(
                  data.collection
                );
              } else if (contractResult.kind === "erc1155") {
                collectionMints = await detector.magiceden.extractByCollectionERC1155(
                  data.collection,
                  data.tokenId ?? "0"
                );
              }

              if (collectionMints.length) {
                logger.info(
                  "magiceden-mint-detection",
                  JSON.stringify({
                    message: `magiceden extractByCollection. collection=${data.collection}, kind=${contractResult.kind}, deployer=${deployer}`,
                    collectionMints,
                  })
                );
              }
            }

            break;
          }

          case "coinbase": {
            collectionMints = await detector.coinbase.extractByCollection(
              data.collection,
              "byCollection"
            );
            break;
          }

          case "coinbase-gallery": {
            collectionMints = await detector.coinbaseGallery.extractByCollection(
              data.collection,
              "byCollection"
            );
            break;
          }

          case "bueno": {
            if (contractResult.kind === "erc721") {
              collectionMints = await detector.bueno.extractByCollectionERC721(
                data.collection,
                data.additionalInfo.phaseIndex
              );
            } else if (contractResult.kind === "erc1155") {
              collectionMints = await detector.bueno.extractByCollectionERC1155(
                data.collection,
                data.tokenId!
              );
            }

            break;
          }
        }

        // Try to extract via the contract metadata if it's available and everything else was unsuccessful
        if (
          !collectionMints.length &&
          contractResult?.metadata?.metadata &&
          data.standard === "unknown"
        ) {
          collectionMints = await detector.extractByContractMetadata(
            data.collection,
            contractResult?.metadata?.metadata,
            contractResult?.deployer ? fromBuffer(contractResult.deployer) : null
          );
        }

        // Also refresh (to clean up any old stages)
        await mintsRefreshJob.addToQueue({ collection: data.collection });
      }

      await Promise.all(
        collectionMints.map(async (collectionMint) => {
          // For specific chain lock simulation
          const lock = [7777777].includes(config.chainId)
            ? await acquireLock(
                `mint-simulation:${collectionMint.collection}:${collectionMint.tokenId}`,
                60 * 5
              )
            : true;

          if (lock) {
            const result = await simulateAndUpsertCollectionMint(collectionMint);

            // Refresh the collection with a delay
            if (result) {
              await triggerDelayedRefresh(collectionMint.collection);
            }
          }
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      logger.error(
        this.queueName,
        `Failed to process mint ${JSON.stringify(payload)}: ${error} (${error.stack})`
      );
      throw error;
    }
  }

  public async addToQueue(mints: MintsProcessJobPayload[], force = false, delay = 0) {
    await this.sendBatch(
      mints.map((mint) => {
        return {
          payload: mint,
          jobId: force ? undefined : mint.by === "tx" ? mint.data.txHash : undefined,
          delay,
        };
      })
    );
  }
}

export const mintsProcessJob = new MintsProcessJob();
