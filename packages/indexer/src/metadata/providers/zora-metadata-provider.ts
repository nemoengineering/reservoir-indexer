/* eslint-disable @typescript-eslint/no-explicit-any */

import axios from "axios";
import _ from "lodash";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { getNetworkName } from "@/orderbook/mints/calldata/detector/zora";

import { AbstractBaseMetadataProvider } from "./abstract-base-metadata-provider";
import { normalizeCollectionMetadata, normalizeLink } from "./utils";
import { CollectionMetadata, TokenMetadata } from "../types";

// All Zora IPFS content is only available via Pinata

export class ZoraMetadataProvider extends AbstractBaseMetadataProvider {
  method = "zora";

  // parsers

  _parseToken(metadata: any): TokenMetadata {
    let attributes = metadata?.attributes || metadata?.properties || [];

    if (typeof attributes === "string") {
      attributes = JSON.parse(attributes);
    }

    if (!Array.isArray(attributes)) {
      attributes = Object.keys(attributes).map((key) => {
        if (typeof attributes[key] === "object") {
          return {
            trait_type: key,
            value: attributes[key],
          };
        } else {
          return {
            trait_type: key,
            value: attributes[key],
          };
        }
      });
    }

    const imageUrl = normalizeLink(metadata?.image, true, "pinata") || null;

    const parsedMetadata = {
      attributes,
      contract: metadata.contract,
      slug: null,
      tokenURI: metadata.uri,
      tokenId: metadata.tokenId,
      collection: _.toLower(metadata.contract),
      name: metadata?.name || metadata?.tokenName || null,
      flagged: null,
      description: _.isArray(metadata?.description)
        ? metadata.description[0]
        : metadata.description || null,
      imageUrl,
      imageOriginalUrl: metadata?.image || metadata?.image_url || null,
    };

    if (config.debugMetadataIndexingCollections.includes(metadata.contract)) {
      logger.info(
        "onchain-fetcher",
        JSON.stringify({
          topic: "tokenMetadataIndexing",
          message: `_parseToken. contract=${metadata.contract}, tokenId=${metadata.tokenId}`,
          debugMetadataIndexingCollection: true,
          metadata: JSON.stringify(metadata),
          parsedMetadata: JSON.stringify(parsedMetadata),
        })
      );
    }

    return parsedMetadata;
  }

  parseCollection(metadata: any): CollectionMetadata {
    return {
      id: metadata.contract,
      slug: null,
      community: null,
      name: metadata?.name || null,
      metadata: normalizeCollectionMetadata(metadata, "pinata"),
      contract: metadata.contract,
      tokenSetId: `contract:${metadata.contract}`,
      tokenIdRange: null,
    };
  }

  // get metadata methods

  protected async _getTokensMetadata(
    tokens: { contract: string; tokenId: string }[]
  ): Promise<TokenMetadata[]> {
    try {
      const premints = await axios
        .get(
          `https://api.zora.co/premint/signature/${getNetworkName(config.chainId)}/${
            tokens[0].contract
          }`
        )
        .then((response) => response.data.premints);
      return Promise.all(
        premints.map(async (pm: any) => {
          const token = await axios
            .get(normalizeLink(pm.tokenConfig.tokenURI, true, "pinata")!)
            .then((response) => response.data);

          return this._parseToken({
            ...token,
            contract: tokens[0].contract,
            tokenId: tokens[0].tokenId,
          });
        })
      );
    } catch (error) {
      if (config.debugMetadataIndexingCollections.includes(tokens[0].contract)) {
        logger.warn(
          "zora-fetcher",
          JSON.stringify({
            message: `Could not fetch tokens. error=${error}`,
            tokens,
            error,
          })
        );
      }

      throw error;
    }
  }

  async _getCollectionMetadata(contract: string): Promise<CollectionMetadata> {
    try {
      const contractURI = await axios
        .get(`https://api.zora.co/premint/signature/${getNetworkName(config.chainId)}/${contract}`)
        .then((response) => response.data.contract_uri);

      const collection = await axios
        .get(normalizeLink(contractURI, true, "pinata")!)
        .then((response) => response.data);

      const collectionName = collection?.name ?? null;
      return this.parseCollection({
        ...collection,
        contract,
        name: collectionName,
      });
    } catch (error) {
      if (config.debugMetadataIndexingCollections.includes(contract)) {
        logger.warn(
          "zora-fetcher",
          JSON.stringify({
            message: `_getCollectionMetadata. Could not fetch collection.  contract=${contract}, error=${error}`,
            contract,
            error,
            debugMetadataIndexingCollection: true,
          })
        );
      }

      return {
        id: contract,
        slug: null,
        name: contract,
        community: null,
        metadata: null,
        contract,
        tokenIdRange: null,
        tokenSetId: `contract:${contract}`,
        isFallback: true,
      };
    }
  }
}

export const zoraMetadataProvider = new ZoraMetadataProvider();
