/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";
import { MetadataProvidersMap } from "@/metadata/providers";
import { CollectionMetadata, TokenMetadata } from "@/metadata/types";
import { logger } from "@/common/logger";

export class MetadataProviderRouter {
  public static async getCollectionMetadata(
    contract: string,
    tokenId: string,
    community = "",
    options?: {
      allowFallback?: boolean;
      indexingMethod?: string;
      additionalQueryParams?: { [key: string]: string };
      context?: string;
    }
  ): Promise<CollectionMetadata> {
    if (config.liquidityOnly) {
      return await MetadataProvidersMap["onchain"].getCollectionMetadata(contract, tokenId);
    }

    const indexingMethod = options?.indexingMethod ?? config.metadataIndexingMethodCollection;

    let collectionMetadata: CollectionMetadata = await MetadataProvidersMap[
      indexingMethod
    ].getCollectionMetadata(contract, tokenId);

    if (
      collectionMetadata?.isFallback &&
      indexingMethod !== "onchain" &&
      collectionMetadata.fallbackReason?.includes("not found")
    ) {
      collectionMetadata = await MetadataProvidersMap["onchain"].getCollectionMetadata(
        contract,
        tokenId
      );

      logger.info(
        "MetadataProviderRouter",
        JSON.stringify({
          message: `getCollectionMetadata fallback to onchain. contract=${contract}, tokenId=${tokenId}, community=${community}, context=${options?.context}`,
          options,
          collectionMetadata,
          context: options?.context,
        })
      );
    }

    if (collectionMetadata?.isFallback && !options?.allowFallback) {
      throw new Error("Fallback collection data not acceptable");
    }

    return collectionMetadata;
  }

  public static async getTokensMetadata(
    tokens: { contract: string; tokenId: string }[],
    method = ""
  ): Promise<TokenMetadata[]> {
    method = method === "" ? config.metadataIndexingMethod : method;

    if (!MetadataProvidersMap[method]) {
      throw new Error(`Metadata provider ${method} not found`);
    }
    return await MetadataProvidersMap[method].getTokensMetadata(tokens);
  }
}

export { MetadataProviderRouter as default };
