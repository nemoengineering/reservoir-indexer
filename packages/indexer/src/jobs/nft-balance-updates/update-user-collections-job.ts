import { edb, pgp } from "@/common/db";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";
import { bn, toBuffer } from "@/common/utils";
import { AddressZero } from "@ethersproject/constants";
import { getNetworkSettings } from "@/config/network";
import _ from "lodash";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { Tokens } from "@/models/tokens";
import { Collections } from "@/models/collections";
import { config } from "@/config/index";
import { acquireLock } from "@/common/redis";
import { resyncUserCollectionsJob } from "@/jobs/nft-balance-updates/reynsc-user-collections-job";
import { fetchCollectionMetadataJob } from "@/jobs/token-updates/fetch-collection-metadata-job";

export type UpdateUserCollectionsJobPayload = {
  fromAddress?: string;
  toAddress: string;
  contract: string;
  tokenId: string;
  amount: string;
};

export default class UpdateUserCollectionsJob extends AbstractRabbitMqJobHandler {
  queueName = "user-collections";
  maxRetries = 15;
  concurrency = _.includes([56, 204], config.chainId) ? 1 : 5;
  backoff = {
    type: "exponential",
    delay: 5000,
  } as BackoffStrategy;
  disableErrorLogs = true;
  enableFailedJobsRetry = true;

  public async process(payload: UpdateUserCollectionsJobPayload) {
    const { fromAddress, toAddress, contract, tokenId, amount } = payload;
    const queries = [];

    if (
      [
        "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
        "0x59b25ab069a9134463d588ee40f803665d0cf4b0",
        "0xfe265d7da0b67e3417492f5d4a32e5bf6923a98e",
        "0x4923917e9e288b95405e2c893d0ac46b895dda22",
        "0x26fc107e699bdba640647f91d093eee2bccbd0e3",
        "0x62c9c4bcf784ad09b34f366a769ce4a00a4d0255",
        "0xe32e2918c6f66974137cd47ca6dd96ac2b112218",
        "0x7a2a4f9a6481a669c79abed1e3dfead3f1953e4b",
        "0xfed438db5977f742a8205a45c4e59d4043224144",
        "0xe17ba9b39adcd261247108b26c06dd49808e2537",
        "0x8babe36bea71afa850ffcda8f5849a27b5ad9756",
      ].includes(contract)
    ) {
      return;
    }

    // Try to get the collection from the token record
    let collection = await Tokens.getCollection(contract, tokenId);

    // If no collection found throw an error to trigger a retry
    if (!collection) {
      // Get the collection by token range
      collection = await Collections.getByContractAndTokenId(contract, Number(tokenId));

      if (!collection) {
        const acquiredLock = await acquireLock(
          `${this.queueName}-refresh-token-metadata:${contract}:${tokenId}`,
          60 * 60
        );

        if (acquiredLock) {
          // Try refreshing the token
          await metadataIndexFetchJob.addToQueue(
            [
              {
                kind: "single-token",
                data: {
                  method: config.metadataIndexingMethod,
                  contract,
                  tokenId,
                  collection: contract,
                },
                context: "update-user-collections",
              },
            ],
            true
          );
        }

        throw new Error(`no collection found`);
      }
    }

    // Don't update transfer from zero
    if (fromAddress && fromAddress !== AddressZero) {
      queries.push(`
        INSERT INTO user_collections (owner, collection_id, contract, token_count, is_spam)
        VALUES ($/fromAddress/, $/collection/, $/contract/, $/negativeAmount/, $/isSpam/)
        ON CONFLICT (owner, collection_id)
        DO UPDATE SET token_count = user_collections.token_count - $/amount/, is_spam = $/isSpam/, updated_at = now();
      `);
    }

    // Don't update burn addresses
    if (!_.includes(getNetworkSettings().burnAddresses, toAddress)) {
      queries.push(`
        INSERT INTO user_collections (owner, collection_id, contract, token_count, is_spam)
        VALUES ($/toAddress/, $/collection/, $/contract/, $/amount/, $/isSpam/)
        ON CONFLICT (owner, collection_id)
        DO UPDATE SET token_count = GREATEST(user_collections.token_count, 0) + $/amount/, is_spam = $/isSpam/, updated_at = now();
      `);
    }

    if (!_.isEmpty(queries)) {
      await edb.none(pgp.helpers.concat(queries), {
        fromAddress: fromAddress ? toBuffer(fromAddress) : "",
        toAddress: toBuffer(toAddress),
        collection: collection.id,
        contract: toBuffer(contract),
        amount,
        negativeAmount: bn(0).sub(amount).toString(),
        isSpam: collection.isSpam,
      });
    }
  }

  public async processDeadLetter(payload: UpdateUserCollectionsJobPayload) {
    const { fromAddress, toAddress, contract, tokenId } = payload;

    const collection = await Tokens.getCollection(contract, tokenId);

    if (collection) {
      const jobs = [
        {
          user: toAddress,
          collectionId: collection.id,
          fullResync: true,
        },
      ];

      if (fromAddress) {
        jobs.push({
          user: fromAddress,
          collectionId: collection.id,
          fullResync: true,
        });
      }

      await resyncUserCollectionsJob.addToQueue(jobs);
    } else {
      await fetchCollectionMetadataJob.addToQueue([
        {
          contract,
          tokenId,
          context: "process-user-collection-dead-letter",
        },
      ]);

      throw new Error(
        `no collection found in processDeadLetter contract=${contract}, tokenId=${tokenId}`
      );
    }
  }

  public async addToQueue(payload: UpdateUserCollectionsJobPayload[]) {
    await this.sendBatch(
      payload.map((p) => {
        return {
          payload: p,
        };
      })
    );
  }
}

export const updateUserCollectionsJob = new UpdateUserCollectionsJob();
