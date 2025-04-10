import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { Collections } from "@/models/collections";
import { idb, ridb } from "@/common/db";
import {
  ActionsLogContext,
  actionsLogJob,
  ActionsLogOrigin,
} from "@/jobs/general-tracking/actions-log-job";
import { CollectionsEntity } from "@/models/collections/collections-entity";
import { config } from "@/config/index";
import { logger } from "@/common/logger";

export type CollectionCheckSpamJobPayload = {
  collectionId: string;
  trigger:
    | "metadata-changed"
    | "transfer-burst"
    | "marked-as-verified"
    | "same-recipient-transfer-burst";
};

export default class CollectionCheckSpamJob extends AbstractRabbitMqJobHandler {
  queueName = "collections-check-spam";
  maxRetries = 10;
  concurrency = 1;
  useSharedChannel = true;

  public async process(payload: CollectionCheckSpamJobPayload) {
    const { collectionId, trigger } = payload;
    const collection = await Collections.getById(collectionId, true);

    if (collection) {
      // if the spam was manually set by a trusted partner, don't change it
      if (collection.isSpam === 100 || collection.isSpam === -100) {
        return;
      }

      if (trigger === "marked-as-verified") {
        // If marked as verified make mark any other collection with similar name as spam
        await this.checkForCollectionsWithSimilarName(collection);
      }

      const collectionIsVerified =
        collection.metadata?.safelistRequestStatus === "verified" ||
        collection.metadata?.magicedenVerificationStatus === "verified";

      // if the collection is verified and marked as not spam -> do nothing
      if (collectionIsVerified && collection.isSpam <= 0) {
        return;
      }

      // if the collection is verified and marked as spam -> unspam the collection
      if (collectionIsVerified && collection.isSpam > 0) {
        await this.updateSpamStatus(collection.id, -1);

        logger.info(this.queueName, `collection ${collection.id} is spam but marked as verified`);

        // Track the change
        await actionsLogJob.addToQueue([
          {
            context: ActionsLogContext.SpamCollectionUpdate,
            origin: ActionsLogOrigin.MarkedAsVerified,
            actionTakerIdentifier: this.queueName,
            collection: collection.id,
            data: {
              newSpamState: -1,
            },
          },
        ]);

        return;
      }

      // If collection marked as verified or not spam by a user or already mark as spam
      if (collectionIsVerified || collection.isSpam < -1 || collection.isSpam > 0) {
        return;
      }

      if (trigger === "metadata-changed") {
        // Check if the collection name is in the spam list
        if (await this.checkNameFromList(collection)) {
          return;
        }

        // Check if the collection has similar name to a verified collection
        if (await this.checkIfNameSimilarToVerified(collection)) {
          return;
        }
      }

      if (trigger === "transfer-burst") {
        // check if there is royalty in the collection
        if (collection?.royalties?.length === 0) {
          await this.updateSpamStatus(collection.id, 1);

          logger.info(
            this.queueName,
            `collection ${collection.id} is spam by burst and no royalties`
          );

          // Track the change
          await actionsLogJob.addToQueue([
            {
              context: ActionsLogContext.SpamCollectionUpdate,
              origin: ActionsLogOrigin.TransferBurstSpamCheck,
              actionTakerIdentifier: this.queueName,
              collection: collection.id,
              data: {
                newSpamState: 1,
              },
            },
          ]);
        }
      }

      if (trigger === "same-recipient-transfer-burst") {
        await this.updateSpamStatus(collection.id, 1);

        logger.info(
          this.queueName,
          `collection ${collection.id} is spam by burst transfer to same recipient`
        );

        // Track the change
        await actionsLogJob.addToQueue([
          {
            context: ActionsLogContext.SpamCollectionUpdate,
            origin: ActionsLogOrigin.SameRecipientTransferBurstSpamCheck,
            actionTakerIdentifier: this.queueName,
            collection: collection.id,
            data: {
              newSpamState: 1,
            },
          },
        ]);
      }
    }
  }

  public async checkNameFromList(collection: CollectionsEntity) {
    const newSpamState = 1;

    for (const spamName of config.spamNames) {
      if (collection.name.match(new RegExp("\\b" + spamName + "\\b", "gi"))) {
        // The name includes a spam word Collection is spam update track and return
        await this.updateSpamStatus(collection.id, newSpamState);

        logger.info(
          this.queueName,
          `collection ${collection.id} newSpamState ${newSpamState} ${JSON.stringify({
            newSpamState,
            criteria: spamName,
            collectionName: collection.name,
          })}`
        );

        // Track the change
        await actionsLogJob.addToQueue([
          {
            context: ActionsLogContext.SpamCollectionUpdate,
            origin: ActionsLogOrigin.NameSpamCheck,
            actionTakerIdentifier: this.queueName,
            collection: collection.id,
            data: {
              newSpamState,
              criteria: spamName,
              collectionName: collection.name,
            },
          },
        ]);

        return true;
      }
    }

    return false;
  }

  public async checkName(collection: CollectionsEntity) {
    const newSpamState = 1;

    // Check for spam by name
    const nameQuery = `
        SELECT *
        FROM spam_name_criteria
        WHERE name ILIKE '%${collection.name}%'
        LIMIT 1
      `;

    const nameQueryResult = await idb.oneOrNone(nameQuery);

    if (nameQueryResult) {
      // Collection is spam update track and return
      await this.updateSpamStatus(collection.id, newSpamState);

      // Track the change
      await actionsLogJob.addToQueue([
        {
          context: ActionsLogContext.SpamCollectionUpdate,
          origin: ActionsLogOrigin.NameSpamCheck,
          actionTakerIdentifier: this.queueName,
          collection: collection.id,
          data: {
            newSpamState,
            criteria: nameQueryResult.name,
            collectionName: collection.name,
          },
        },
      ]);

      return true;
    }

    return false;
  }

  public async checkForCollectionsWithSimilarName(verifiedCollection: CollectionsEntity) {
    const newSpamState = 1;

    // Fetch any collections with similar name to a verified collections and are not verified
    const similarCollectionsQuery = `
      SELECT id, name
      FROM collections
      WHERE name ILIKE $/collectionName/
      AND id != $/collectionId/
      AND (metadata->>'safelistRequestStatus' != 'verified' OR metadata->>'safelistRequestStatus' IS NULL)
      AND (metadata->>'magicedenVerificationStatus' != 'verified' OR metadata->>'magicedenVerificationStatus' IS NULL)
      AND (is_spam IS NULL OR is_spam IN(0, -1))
    `;

    const similarCollectionsQueryResult = await ridb.manyOrNone(similarCollectionsQuery, {
      collectionId: verifiedCollection.id,
      collectionName: verifiedCollection.name,
    });

    if (similarCollectionsQueryResult) {
      // Mark the collections as spam
      for (const similarCollection of similarCollectionsQueryResult) {
        logger.info(
          this.queueName,
          `collection ${similarCollection.id} has similar name ${similarCollection.name} to a verified collection`
        );

        // Collection is spam update track and return
        await this.updateSpamStatus(similarCollection.id, newSpamState);

        // Track the change
        await actionsLogJob.addToQueue([
          {
            context: ActionsLogContext.SpamCollectionUpdate,
            origin: ActionsLogOrigin.VerifiedCollectionName,
            actionTakerIdentifier: this.queueName,
            collection: similarCollection.id,
            data: {
              newSpamState,
              collectionName: similarCollection.name,
              verifiedCollectionName: verifiedCollection.name,
              verifiedCollectionId: verifiedCollection.id,
            },
          },
        ]);
      }
    }
  }

  public async checkIfNameSimilarToVerified(collection: CollectionsEntity) {
    const newSpamState = 1;

    // Check for spam by name
    const verifiedCollectionQuery = `
      SELECT *
      FROM collections
      WHERE name ILIKE $/collectionName/
      AND id != $/collectionId/
      AND (metadata->>'safelistRequestStatus' = 'verified' OR metadata->>'magicedenVerificationStatus' = 'verified')
      AND (is_spam IS NULL OR is_spam IN(0, -1))
      LIMIT 1
    `;

    const verifiedCollectionQueryResult = await idb.oneOrNone(verifiedCollectionQuery, {
      collectionId: collection.id,
      collectionName: collection.name,
    });

    if (verifiedCollectionQueryResult) {
      logger.info(
        this.queueName,
        `collection ${collection.id} has similar name ${collection.name} to a verified collection`
      );

      // Collection is spam update track and return
      await this.updateSpamStatus(collection.id, newSpamState);

      // Track the change
      await actionsLogJob.addToQueue([
        {
          context: ActionsLogContext.SpamCollectionUpdate,
          origin: ActionsLogOrigin.VerifiedCollectionName,
          actionTakerIdentifier: this.queueName,
          collection: collection.id,
          data: {
            newSpamState,
            collectionName: collection.name,
            verifiedCollectionName: verifiedCollectionQueryResult.name,
            verifiedCollectionId: verifiedCollectionQueryResult.id,
          },
        },
      ]);

      return true;
    }

    return false;
  }

  public async updateSpamStatus(collectionId: string, newSpamStatus: number) {
    return idb.none(
      `
      UPDATE collections
      SET is_spam = $/newSpamStatus/, updated_at = now()
      WHERE id = $/collectionId/
      AND (is_spam IS NULL OR is_spam = ${newSpamStatus > 0 ? "0" : "1"})
    `,
      {
        collectionId,
        newSpamStatus,
      }
    );
  }

  public async addToQueue(params: CollectionCheckSpamJobPayload) {
    await this.send({ payload: params, jobId: params.collectionId });
  }
}

export const collectionCheckSpamJob = new CollectionCheckSpamJob();
