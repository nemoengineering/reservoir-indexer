import _ from "lodash";

import { bn, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { onchainMetadataProvider } from "@/metadata/providers/onchain-metadata-provider";
import { Collections } from "@/models/collections";
import { acquireLock } from "@/common/redis";
import { ridb } from "@/common/db";
import { logger } from "@/common/logger";
import { collectionMetadataQueueJob } from "@/jobs/collection-updates/collection-metadata-queue-job";
import { Tokens } from "@/models/tokens";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  // Handle the events
  for (const { subKind, baseEventParams, log } of events) {
    const eventData = getEventData([subKind])[0];

    const contract = baseEventParams.address.toLowerCase();
    const collection = await Collections.getById(contract);

    switch (subKind) {
      case "metadata-update-single-token-opensea": {
        const parsedLog = eventData.abi.parseLog(log);
        const tokenId = parsedLog.args["_tokenId"].toString();

        const acquiredLock = await acquireLock(
          `metadata-update:${subKind}:${baseEventParams.block}:${contract}:${tokenId}`,
          300
        );

        if (!acquiredLock) {
          continue;
        }

        // Check: token doesn't exist
        const tokenExists = await ridb.oneOrNone(
          `SELECT 1 FROM tokens WHERE tokens.contract = $/contract/ AND tokens.token_id=$/tokenId/`,
          {
            contract: toBuffer(contract),
            tokenId,
          }
        );

        if (!tokenExists) {
          continue;
        }

        // Trigger a refresh for token of tokenId and baseEventParams.address
        await metadataIndexFetchJob.addToQueue(
          [
            {
              kind: "single-token",
              data: {
                method: config.metadataIndexingMethod,
                collection: collection?.id || contract,
                contract,
                tokenId: tokenId,
              },
              context: "onchain-metadata-update-single-token",
            },
          ],
          false,
          5
        );
        break;
      }

      case "metadata-update-batch-tokens-opensea": {
        const parsedLog = eventData.abi.parseLog(log);
        const fromToken = parsedLog.args["_fromTokenId"].toString();
        const toToken = parsedLog.args["_toTokenId"].toString();

        // If _toToken = type(uint256).max, then this is just a collection refresh

        if (toToken === bn(2).pow(256).sub(1).toString()) {
          // Trigger a refresh for all tokens of baseEventParams.address
          await metadataIndexFetchJob.addToQueue([
            {
              kind: "full-collection",
              data: {
                method: config.metadataIndexingMethod,
                collection: collection?.id || contract,
              },
              context: "onchain-metadata-update-batch-tokens",
            },
          ]);
        } else {
          // Trigger a refresh for all tokens  fromToken to toToken of baseEventParams.address

          // Don't do this if the amount of tokens is bigger than maxTokenSetSize
          if (parseInt(toToken) - parseInt(fromToken) > config.maxTokenSetSize) {
            break;
          }

          await metadataIndexFetchJob.addToQueue(
            _.range(parseInt(fromToken), parseInt(toToken) + 1).map((tokenId) => ({
              kind: "single-token",
              data: {
                method: config.metadataIndexingMethod,
                collection: collection?.id || contract,
                contract,
                tokenId: tokenId.toString(),
              },
              context: "onchain-metadata-update-batch-tokens",
            })),
            false,
            5
          );
        }

        break;
      }

      case "metadata-update-uri-opensea":
      case "metadata-update-zora":
      case "metadata-update-contract-uri-thirdweb":
      case "metadata-update-contract-uri-magiceden": {
        logger.log(
          config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
          "handleEvents",
          JSON.stringify({
            topic: "CollectionNewContractDeployedJob",
            message: `Debug. contract=${contract}, subKind=${subKind}`,
            collection,
            debugMetadataIndexingCollection:
              config.debugMetadataIndexingCollections.includes(contract),
          })
        );

        // Refresh the collection metadata
        const tokenId = await Tokens.getSingleToken(contract);

        await collectionMetadataQueueJob.addToQueue({
          contract: contract,
          tokenId,
          community: collection?.community,
          forceRefresh: true,
        });

        break;
      }

      case "metadata-update-mint-config-changed": {
        const rawMetadata = await onchainMetadataProvider.getContractURI(baseEventParams.address);

        if (rawMetadata?.mintConfig) {
          onChainData.mints.push({
            by: "contractMetadata",
            data: {
              collection: baseEventParams.address.toLowerCase(),
              metadata: rawMetadata,
            },
          });
        }

        break;
      }
    }
  }
};
