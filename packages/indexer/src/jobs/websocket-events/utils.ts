import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import * as kafkaStreamProducer from "@/common/kafka-stream-producer";
import { getChainName } from "@/config/network";
import { publishEventToKafkaStreamJob } from "@/jobs/websocket-events/publish-event-to-kafka-stream-job";
import { config } from "@/config/index";
import { redis } from "@/common/redis";
import _ from "lodash";
import * as erc721c from "@/utils/erc721c";
import * as marketplaceBlacklist from "@/utils/marketplace-blacklists";

export interface KafkaEvent {
  event: string;
  changed?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

// Utility functions for parsing cdc event data

export async function getTokenMetadata(tokenId: string, contract: string) {
  const r = await idb.oneOrNone(
    `
    SELECT
      tokens.name,
      tokens.image,
      COALESCE(tokens.metadata_version::TEXT, tokens.image_version::TEXT) AS image_version,
      (tokens.metadata ->> 'image_mime_type')::TEXT AS image_mime_type,
      tokens.collection_id,
      contracts.kind as contract_kind,
      collections.name AS collection_name
    FROM tokens
    LEFT JOIN contracts 
      ON tokens.contract = contracts.address
    LEFT JOIN collections 
      ON tokens.collection_id = collections.id
    WHERE tokens.contract = $/contract/ AND tokens.token_id = $/token_id/
  `,
    {
      token_id: tokenId,
      contract: toBuffer(contract),
    }
  );

  return r;
}

export async function getContractData(contract: string) {
  let contractData;

  const cachedContractData = await redis.get(`contract-data:${contract}`);

  if (cachedContractData) {
    contractData = JSON.parse(cachedContractData);
  }

  if (!contractData) {
    contractData = await idb.oneOrNone(
      `
          SELECT
            con.kind,
            extract(epoch from con.deployed_at) AS deployed_at
          FROM contracts con
          WHERE con.address = $/contract/
        `,
      {
        contract: toBuffer(contract),
      }
    );

    if (contractData?.kind) {
      await redis.set(`contract-data:${contract}`, JSON.stringify(contractData), "EX", 86400);
    }
  }

  return contractData;
}

export async function getContractSecurityConfig(contract: string, forceRefresh = false) {
  let contractSecurityConfig = undefined;

  if (!forceRefresh) {
    const cachedContractSecurityConfig = await redis.get(`contract-security-config:${contract}`);

    if (cachedContractSecurityConfig) {
      contractSecurityConfig = JSON.parse(cachedContractSecurityConfig);
    }
  }

  if (!contractSecurityConfig) {
    const [v1, v2, v3, ofr] = await Promise.all([
      erc721c.v1.getConfigFromDb(contract),
      erc721c.v2.getConfigFromDb(contract),
      erc721c.v3.getConfigFromDb(contract),
      marketplaceBlacklist.getMarketplaceBlacklistFromDb(contract),
    ]);

    if (v1) {
      contractSecurityConfig = {
        operatorWhitelist: v1.operatorWhitelist,
        receiverAllowList: v1.permittedContractReceiverAllowlist,
        transferSecurityLevel: v1.transferSecurityLevel,
        transferValidator: v1.transferValidator,
      };
    } else if (v2) {
      contractSecurityConfig = {
        operatorWhitelist: v2.whitelist.accounts,
        operatorBlacklist: v2.blacklist.accounts,
        transferSecurityLevel: v2.transferSecurityLevel,
        transferValidator: v2.transferValidator,
      };
    } else if (v3) {
      contractSecurityConfig = {
        operatorWhitelist: v3.whitelist.accounts,
        operatorBlacklist: v3.blacklist.accounts,
        transferSecurityLevel: v3.transferSecurityLevel,
        transferValidator: v3.transferValidator,
      };
    } else {
      contractSecurityConfig = {
        operatorBlacklist: ofr.blacklist,
      };
    }

    await redis.set(
      `contract-security-config:${contract}`,
      JSON.stringify(contractSecurityConfig),
      "EX",
      86400
    );
  }

  return contractSecurityConfig;
}

export async function getSampleImages(collectionId: string) {
  const { sample_images } = await idb.oneOrNone(
    `SELECT
          ARRAY(
            SELECT
              json_build_object(
                  'image', tokens.image,
                  'image_mime_type', (tokens.metadata ->> 'image_mime_type')::TEXT
              )
            FROM tokens
            WHERE tokens.collection_id = $/collectionId/
            ORDER BY rarity_rank DESC NULLS LAST
            LIMIT 4
          ) AS sample_images`,
    {
      collectionId,
    }
  );

  return _.filter(
    sample_images,
    (sampleImage) => !_.isNull(sampleImage.image) && _.startsWith(sampleImage.image, "http")
  );
}

export const formatValidBetween = (validBetween: string) => {
  try {
    const parsed = JSON.parse(validBetween.replace("infinity", "null"));
    return {
      validFrom: Math.floor(new Date(parsed[0]).getTime() / 1000),
      validUntil: Math.floor(new Date(parsed[1]).getTime() / 1000),
    };
  } catch (error) {
    return {
      validFrom: null,
      validUntil: null,
    };
  }
};

export const formatStatus = (fillabilityStatus: string, approvalStatus: string) => {
  switch (fillabilityStatus) {
    case "filled":
      return "filled";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "no-balance":
      return "inactive";
  }

  switch (approvalStatus) {
    case "no-approval":
    case "disabled":
      return "inactive";
  }

  return "active";
};

export const publishKafkaEvent = async (event: KafkaEvent): Promise<void> => {
  if (!config.doKafkaStreamWork) {
    return;
  }

  const topic = mapEventToKafkaTopic(event);
  const partitionKey = mapEventToKafkaPartitionKey(event);

  const published = await kafkaStreamProducer.publish(topic, event, partitionKey);

  if (!published) {
    await publishEventToKafkaStreamJob.addToQueue([{ event }]);
  }
};

const mapEventToKafkaTopic = (event: KafkaEvent): string => {
  return `ks.${getChainName()}.${event.event.split(".")[0]}s`;
};

const mapEventToKafkaPartitionKey = (event: KafkaEvent): string => {
  switch (event.event.split(".")[0]) {
    case "collection":
      return event.data.id;
    case "token":
      return event.data.token.collection.id || event.data.token.contract;
    case "ask":
      return event.data.id;
    case "bid":
      return event.data.id;
    case "sale":
      return event.data.token.collection.id || event.data.token.contract;
    case "transfer":
      return event.data.token.contract;
    case "pending-tx":
      return event.data.contract;
  }

  return "";
};
