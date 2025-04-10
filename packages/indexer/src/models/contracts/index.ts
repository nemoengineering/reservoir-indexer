/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";
import { initOnChainData, processOnChainData } from "@/events-sync/handlers/utils";

import { collectionNewContractDeployedJob } from "@/jobs/collections/collection-contract-deployed";
import { getContractNameAndSymbol, getContractOwner } from "@/jobs/collections/utils";
import { onchainMetadataProvider } from "@/metadata/providers/onchain-metadata-provider";
import { Network } from "@reservoir0x/sdk/dist/utils";
import { config } from "@/config/index";
import { logger } from "@/common/logger";

export class Contracts {
  public static async updateContractMetadata(contract: string) {
    const contractExists = await idb.oneOrNone(
      `
        SELECT
          kind,  
          symbol,
          name
        FROM contracts
        WHERE contracts.address = $/contract/
      `,
      {
        contract: toBuffer(contract),
      }
    );

    if (!contractExists) {
      // If the collection doesn't exist, push a job to retrieve it
      await collectionNewContractDeployedJob.addToQueue({
        contract,
      });

      return;
    }

    let contractMetadata;

    if (config.chainId === Network.Base || config.chainId === Network.BaseSepolia) {
      try {
        contractMetadata = await onchainMetadataProvider.getContractURI(contract);

        if (contractMetadata?.mintConfig) {
          const onChainData = initOnChainData();

          onChainData.mints.push({
            by: "contractMetadata",
            data: {
              collection: contract,
              metadata: contractMetadata,
            },
          });

          await processOnChainData(onChainData, false);
        }
      } catch (error) {
        logger.error("updateContractMetadata", `initOnChainDataError. contract=${contract}`);
      }
    }

    // if symbol and name are already set, skip
    if (contractExists.symbol && contractExists.name) {
      return;
    }

    if (!contractMetadata) {
      contractMetadata = await onchainMetadataProvider.getContractURI(contract);
    }

    const contractNameAndSymbol = await getContractNameAndSymbol(contract);

    const name = contractNameAndSymbol.name ?? contractMetadata?.name;
    const symbol = contractNameAndSymbol.symbol ?? contractMetadata?.symbol;

    const contractOwner = await getContractOwner(contract);

    logger.log(
      config.debugMetadataIndexingCollections.includes(contract) ? "info" : "debug",
      "updateContractMetadata",
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `Update. contract=${contract}`,
        contractExists,
        contractMetadata,
        symbol,
        name,
        contractOwner,
        debugMetadataIndexingCollection: config.debugMetadataIndexingCollections.includes(contract),
      })
    );

    await idb.none(
      `
        UPDATE contracts
        SET
          symbol = $/symbol/,
          name = $/name/,
          metadata = $/metadata:json/,
          owner = $/owner/,
          updated_at = now()
        WHERE contracts.address = $/contract/
      `,
      {
        contract: toBuffer(contract),
        symbol: symbol || null,
        name: name || null,
        metadata: contractMetadata ? contractMetadata : null,
        owner: contractOwner ? toBuffer(contractOwner) : null,
      }
    );
  }
}
