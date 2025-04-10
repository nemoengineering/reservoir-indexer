/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";
import { CollectionMetadata, TokenMetadata } from "../types";

import axios from "axios";
import { RequestWasThrottledError, normalizeLink } from "./utils";
import _ from "lodash";
import { getChainName } from "@/config/network";

import { AbstractBaseMetadataProvider } from "./abstract-base-metadata-provider";
import { Network } from "@reservoir0x/sdk/dist/utils";
import { logger } from "@/common/logger";

export class AlchemyMetadataProvider extends AbstractBaseMetadataProvider {
  method = "alchemy";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async _getCollectionMetadata(contract: string, tokenId: string): Promise<CollectionMetadata> {
    throw new Error("Method not implemented.");
  }

  async _getTokensMetadata(
    tokens: { contract: string; tokenId: string }[]
  ): Promise<TokenMetadata[]> {
    const network = this.getAlchemyNetworkName();

    const url = `https://${network}.g.alchemy.com/v2/${config.alchemyMetadataApiKey}/getNFTMetadataBatch`;
    const data = await axios
      .post(url, {
        refreshCache: true,
        tokens: tokens.map(({ contract, tokenId }) => ({
          contractAddress: contract,
          tokenId: tokenId,
        })),
      })
      .then((response) => response.data)
      .catch((error) => this.handleError(error));

    return data
      .filter((nft: any) => !nft.error)
      .map((nft: any) => this.parseToken(nft))
      .filter(Boolean);
  }

  handleError(error: any) {
    logger.error(
      "alchemy-fetcher",
      JSON.stringify({
        message: `error. message=${error.message}, status=${error.response?.status}, url=${error.config?.url}`,
        error,
        requestHeaders: error.config?.headers,
        responseData: JSON.stringify(error.response?.data),
      })
    );

    if (error.response?.status === 429 || error.response?.status === 503) {
      let delay = 1;

      if (error.response.data.detail?.startsWith("Request was throttled. Expected available in")) {
        try {
          delay = error.response.data.detail.split(" ")[6];
        } catch {
          // Skip on any errors
        }
      }

      throw new RequestWasThrottledError(error.response.statusText, delay);
    }

    throw error;
  }

  _parseToken(data: any): TokenMetadata {
    const imageData = data.media?.length ? data.media[0] : null;
    const imageUrl = imageData?.gateway || data.metadata.image;
    const mediaUrl = data.metadata.animation_url;
    const imageOriginalUrl = data.metadata.image?.startsWith("data:") ? null : data.metadata.image;

    const parsedData = {
      contract: _.toLower(data.contract.address),
      tokenId: data.id.tokenId,
      name: data.metadata.name,
      collection: _.toLower(data.contract.address),
      flagged: null,
      slug: null,
      description: data.description,
      imageUrl: normalizeLink(imageUrl) || null,
      imageOriginalUrl: imageOriginalUrl || null,
      animationOriginalUrl: data.metadata.animation_url || null,
      metadataOriginalUrl: data.tokenUri.gateway,
      mediaUrl: normalizeLink(mediaUrl) || null,
      attributes: (data.metadata.attributes || []).map((trait: any) => ({
        key: trait.trait_type || "property",
        value: trait.value,
        kind: typeof trait.value == "number" ? "number" : "string",
        rank: 1,
      })),
      imageMimeType: imageData?.format ? `image/${imageData.format}` : undefined,
    };

    return parsedData;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected parseCollection(metadata: any, contract: string): CollectionMetadata {
    throw new Error("Method not implemented.");
  }

  getAlchemyNetworkName(): string {
    if (config.chainId === Network.Ethereum) {
      return "eth-mainnet";
    }

    if (config.chainId === Network.EthereumSepolia) {
      return "eth-sepolia";
    }

    if (config.chainId === Network.MonadTestnet) {
      return "monad-testnet";
    }

    const network = getChainName();

    if (!network) {
      throw new Error("Unsupported chain");
    }

    return `${network}-mainnet`;
  }
}

export const alchemyMetadataProvider = new AlchemyMetadataProvider();
