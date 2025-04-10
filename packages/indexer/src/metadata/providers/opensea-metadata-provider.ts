/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";
import { CollectionMetadata, TokenMetadata } from "../types";
import { logger } from "@/common/logger";
import axios from "axios";
import {
  CollectionNotFoundError,
  RequestWasThrottledError,
  normalizeCollectionMetadata,
  generateFallbackCollectionMetadata,
} from "./utils";
import _ from "lodash";
import { AbstractBaseMetadataProvider } from "./abstract-base-metadata-provider";
import { customHandleToken, hasCustomHandler } from "../custom";
import { extendMetadata, hasExtendHandler } from "../extend";
import { getOpenseaChainName } from "@/config/network";

class OpenseaMetadataProvider extends AbstractBaseMetadataProvider {
  method = "opensea";
  protected async _getCollectionMetadata(
    contract: string,
    tokenId: string
  ): Promise<CollectionMetadata> {
    try {
      const { data, creatorAddress } = await this.getDataWithCreator(contract, tokenId);

      if (!data) {
        return generateFallbackCollectionMetadata(contract, "Missing collection");
      }

      return this.parseCollection(data, contract, creatorAddress);
    } catch (error) {
      logger.error(
        "opensea-fetcher",
        JSON.stringify({
          topic: "fetchCollectionError",
          message: `Could not fetch collection.  contract=${contract}, tokenId=${tokenId}, error=${error}`,
          contract,
          tokenId,
          error,
        })
      );

      return generateFallbackCollectionMetadata(contract, (error as any).message);
    }
  }

  protected async _getTokensMetadata(
    tokens: { contract: string; tokenId: string }[]
  ): Promise<TokenMetadata[]> {
    const tokensMetadata: any[] = [];
    for (const { contract, tokenId } of tokens) {
      const url = `${
        !this.isOSTestnet() ? "https://api.opensea.io" : "https://testnets-api.opensea.io"
      }/api/v2/chain/${getOpenseaChainName()}/contract/${contract}/nfts/${tokenId}`;
      const headers: any = !this.isOSTestnet()
        ? {
            url,
            "X-API-KEY": config.openSeaTokenMetadataApiKey.trim(),
            Accept: "application/json",
          }
        : {
            Accept: "application/json",
          };

      if (!this.isOSTestnet() && config.openSeaApiUrl && config.openSeaNftApiKey) {
        headers["x-nft-api-key"] = config.openSeaNftApiKey;
      }

      const data = await axios
        .get(!this.isOSTestnet() ? config.openSeaApiUrl || url : url, {
          headers,
        })
        .then((response) => response.data)
        .catch((error) => this.handleError(error, "_getTokensMetadata"));

      tokensMetadata.push(data.nft);
    }

    return tokensMetadata.map((nft: any) => this.parseToken(nft)).filter(Boolean);
  }

  async _getTokenFlagStatus(
    contract: string,
    tokenId: string
  ): Promise<{
    data: { contract: string; tokenId: string; isFlagged: boolean };
  }> {
    const domain = !this.isOSTestnet()
      ? "https://api.opensea.io"
      : "https://testnets-api.opensea.io";
    const url = `${domain}/api/v2/chain/${getOpenseaChainName()}/contract/${contract}/nfts/${tokenId}`;
    const headers: any = !this.isOSTestnet()
      ? {
          url,
          "X-API-KEY": config.openSeaTokenFlagStatusApiKey.trim(),
          Accept: "application/json",
        }
      : {
          Accept: "application/json",
        };

    if (!this.isOSTestnet() && config.openSeaApiUrl && config.openSeaNftApiKey) {
      headers["x-nft-api-key"] = config.openSeaNftApiKey;
    }

    const data = await axios
      .get(!this.isOSTestnet() ? config.openSeaApiUrl || url : url, {
        headers,
      })
      .then((response) => response.data)
      .catch((error) => this.handleError(error, "_getTokenFlagStatus"));

    return {
      data: {
        contract: data.nft.contract,
        tokenId: data.nft.identifier,
        isFlagged: data.nft.is_disabled,
      },
    };
  }

  async _getTokensFlagStatusByCollectionPaginationViaSlug(
    slug: string,
    continuation?: string
  ): Promise<{
    data: { contract: string; tokenId: string; isFlagged: boolean }[];
    continuation: string | null;
  }> {
    const searchParams = new URLSearchParams();

    if (continuation) searchParams.append("next", continuation);
    searchParams.append("limit", "50");

    const domain = !this.isOSTestnet()
      ? "https://api.opensea.io"
      : "https://testnets-api.opensea.io";
    const url = `${domain}/api/v2/collection/${slug}/nfts?${searchParams.toString()}`;
    const headers: any = !this.isOSTestnet()
      ? {
          url,
          "X-API-KEY": config.openSeaTokenFlagStatusApiKey.trim(),
          Accept: "application/json",
        }
      : {
          Accept: "application/json",
        };

    if (!this.isOSTestnet() && config.openSeaApiUrl && config.openSeaNftApiKey) {
      headers["x-nft-api-key"] = config.openSeaNftApiKey;
    }

    const data = await axios
      .get(!this.isOSTestnet() ? config.openSeaApiUrl || url : url, {
        headers,
      })
      .then((response) => response.data)
      .catch((error) =>
        this.handleError(error, "_getTokensFlagStatusByCollectionPaginationViaSlug")
      );

    return {
      data: data.nfts.map((asset: any) => ({
        contract: asset.contract,
        tokenId: asset.identifier,
        isFlagged: asset.is_disabled,
      })),
      continuation: data.next ?? undefined,
    };
  }

  async _getTokensFlagStatusByCollectionPaginationViaContract(
    contract: string,
    continuation?: string
  ): Promise<{
    data: { contract: string; tokenId: string; isFlagged: boolean }[];
    continuation: string | null;
  }> {
    const searchParams = new URLSearchParams();

    if (continuation) searchParams.append("next", continuation);
    searchParams.append("limit", "50");

    const domain = !this.isOSTestnet()
      ? "https://api.opensea.io"
      : "https://testnets-api.opensea.io";
    const url = `${domain}/api/v2/chain/${getOpenseaChainName()}/contract/${contract}/nfts?${searchParams.toString()}`;
    const headers: any = !this.isOSTestnet()
      ? {
          url,
          "X-API-KEY": config.openSeaTokenFlagStatusApiKey.trim(),
          Accept: "application/json",
        }
      : {
          Accept: "application/json",
        };

    if (!this.isOSTestnet() && config.openSeaApiUrl && config.openSeaNftApiKey) {
      headers["x-nft-api-key"] = config.openSeaNftApiKey;
    }

    const data = await axios
      .get(!this.isOSTestnet() ? config.openSeaApiUrl || url : url, {
        headers,
      })
      .then((response) => response.data)
      .catch((error) =>
        this.handleError(error, "_getTokensFlagStatusByCollectionPaginationViaContract")
      );

    return {
      data: data.nfts.map((asset: any) => ({
        contract: asset.contract,
        tokenId: asset.identifier,
        isFlagged: asset.is_disabled,
      })),
      continuation: data.next ?? undefined,
    };
  }

  handleError(error: any, context?: string, throwError = true) {
    if (
      error.response?.status === 400 &&
      error.response.data.errors?.some((error: string) => error.includes("not found"))
    ) {
      logger.warn(
        "opensea-fetcher",
        JSON.stringify({
          message: `collectionNotFoundError. context=${context}, message=${error.message}, status=${error.response?.status}, url=${error.config?.url}`,
          context,
          error,
          requestHeaders: error.config?.headers,
          responseData: JSON.stringify(error.response?.data),
        })
      );

      throw new CollectionNotFoundError(error.response.data.errors[0]);
    } else if (error.response?.status === 429 || error.response?.status === 503) {
      let delay = 1;

      if (error.response.data.detail?.startsWith("Request was throttled. Expected available in")) {
        try {
          delay = error.response.data.detail.split(" ")[6];
        } catch {
          // Skip on any errors
        }
      }

      logger.log(
        this.isOSTestnet() ? "debug" : "warn",
        "opensea-fetcher",
        JSON.stringify({
          message: `requestWasThrottledError. context=${context}, message=${error.message}, status=${error.response?.status}, url=${error.config?.url}, delay=${delay}`,
          context,
          error,
          requestHeaders: error.config?.headers,
        })
      );

      if (throwError) throw new RequestWasThrottledError(error.response.statusText, delay);
    } else {
      logger.log(
        throwError ? "error" : "warn",
        "opensea-fetcher",
        JSON.stringify({
          message: `handleError. context=${context}, message=${error.message}, status=${error.response?.status}, url=${error.config?.url}`,
          context,
          error,
          requestHeaders: error.config?.headers,
          responseData: JSON.stringify(error.response?.data),
        })
      );

      if (error.response?.status === 401) {
        logger.error(
          "opensea-fetcher",
          JSON.stringify({
            topic: "opensea-unauthorized-api-key",
            message: `UnauthorizedError. context=${context}, message=${error.message}, url=${error.config?.url}`,
            requestHeaders: error.config?.headers,
            responseData: JSON.stringify(error.response?.data),
          })
        );
      }

      if (throwError) throw error;
    }
  }

  _parseToken(metadata: any): TokenMetadata {
    return {
      contract: metadata.contract,
      tokenId: metadata.identifier,
      collection: _.toLower(metadata.contract),
      slug: metadata.collection,
      name: metadata.name,
      flagged: metadata.is_disabled,
      // Token descriptions are a waste of space for most collections we deal with
      // so by default we ignore them (this behaviour can be overridden if needed).
      description: metadata.description,
      imageUrl: metadata.image_url,
      imageOriginalUrl: metadata.image_url,
      animationOriginalUrl: metadata.animation_url,
      metadataOriginalUrl: metadata.metadata_url,
      mediaUrl: metadata.animation_url,
      attributes: (metadata.traits || []).map((trait: any) => ({
        key: trait.trait_type || "property",
        value: trait.value,
        kind: typeof trait.value == "number" ? "number" : "string",
        rank: 1,
      })),
    };
  }

  parseCollection(metadata: any, contract: string, creator: string): CollectionMetadata {
    // Collect the fees
    const royalties = [];
    const fees = [];

    const openSeaFeeRecipients = [
      "0x5b3256965e7c3cf26e11fcaf296dfc8807c01073",
      "0x8de9c5a032463c561423387a9648c5c7bcc5bc90",
      "0x0000a26b00c1f0df003000390027140000faa719",
    ];

    for (const fee of metadata.fees) {
      if (openSeaFeeRecipients.includes(fee.recipient)) {
        fees.push({
          recipient: fee.recipient,
          bps: Math.trunc(fee.fee * 100),
        });
      } else {
        royalties.push({
          recipient: fee.recipient,
          bps: Math.trunc(fee.fee * 100),
          required: fee.required,
        });
      }
    }

    return {
      id: contract,
      slug: metadata.collection,
      name: metadata.name,
      community: null,
      metadata: normalizeCollectionMetadata(metadata),
      openseaRoyalties: royalties,
      openseaFees: fees,
      contract,
      tokenIdRange: null,
      tokenSetId: `contract:${contract}`,
      paymentTokens: metadata.payment_tokens
        ? metadata.payment_tokens.map((token: any) => {
            return {
              address: token.address,
              decimals: token.decimals,
              name: token.name,
              symbol: token.symbol,
            };
          })
        : undefined,
      creator: creator ? _.toLower(creator) : null,
    };
  }

  async getDataWithCreator(
    contract: string,
    tokenId: string
  ): Promise<{ creatorAddress: string; data: any }> {
    let data;
    let creatorAddress;

    const nftData = await this.getOSData("nft", contract, tokenId);

    if (nftData?.collection) {
      data = await this.getOSDataForCollection(contract, tokenId, nftData.collection);

      creatorAddress = nftData?.creator ?? data?.owner;
    }

    return {
      data,
      creatorAddress,
    };
  }

  async getOSDataForCollection(contract: string, tokenId: string, collection: any): Promise<any> {
    return await this.getOSData("collection", contract, tokenId, collection);
  }

  public async parseTokenMetadata(request: {
    asset_contract: {
      address: string;
    };
    collection: {
      slug: string;
    };
    token_id: string;
    name?: string;
    description?: string;
    image_url?: string;
    animation_url?: string;
    traits: Array<{
      trait_type: string;
      value: string | number | null;
    }>;
  }): Promise<TokenMetadata | null> {
    if (hasCustomHandler(request.asset_contract.address)) {
      const result = await customHandleToken({
        contract: request.asset_contract.address,
        _tokenId: request.token_id,
      });
      return result;
    }

    if (hasExtendHandler(request.asset_contract.address)) {
      const result = await extendMetadata({
        contract: request.asset_contract.address,
        slug: request.collection.slug,
        collection: request.asset_contract.address,
        flagged: null,
        tokenId: request.token_id,
        name: request.name ?? "",
        description: request.description ?? "",
        imageUrl: request.image_url ?? "",
        mediaUrl: request.animation_url ?? "",
        attributes: request.traits.map((trait) => ({
          key: trait.trait_type,
          value: trait.value,
          kind: typeof trait.value == "number" ? "number" : "string",
        })),
      });
      return result;
    }

    return {
      contract: request.asset_contract.address,
      slug: request.collection.slug,
      collection: request.asset_contract.address,
      flagged: null,
      tokenId: request.token_id,
      name: request.name ?? "",
      description: request.description ?? "",
      imageUrl: request.image_url ?? "",
      mediaUrl: request.animation_url ?? "",
      attributes: request.traits.map((trait) => ({
        key: trait.trait_type,
        value: trait.value,
        kind: typeof trait.value == "number" ? "number" : "string",
      })),
    };
  }

  isOSTestnet(): boolean {
    switch (config.chainId) {
      case 4:
      case 5:
      case 11155111:
      case 80001:
      case 80002:
        return true;
    }

    return false;
  }

  getUrlForApi(
    api: string,
    contract: string,
    tokenId?: string,
    network?: string,
    slug?: string
  ): string {
    const baseUrl = `${
      !this.isOSTestnet() ? "https://api.opensea.io" : "https://testnets-api.opensea.io"
    }`;

    switch (api) {
      case "offers":
        return `${baseUrl}/v2/orders/${network}/seaport/offers?asset_contract_address=${contract}&token_ids=${tokenId}`;
      case "collection":
        return `${baseUrl}/api/v2/collections/${slug}`;
      case "nft":
        return `${baseUrl}/v2/chain/${network}/contract/${contract}/nfts/${tokenId}`;
      default:
        throw new Error(`Unknown API for metadata provider opensea: ${api}`);
    }
  }

  async getOSData(api: string, contract: string, tokenId?: string, slug?: string): Promise<any> {
    const network = getOpenseaChainName();
    const url = this.getUrlForApi(api, contract, tokenId, network!, slug);

    const headers: any = !this.isOSTestnet()
      ? {
          url,
          "X-API-KEY": config.openSeaCollectionMetadataApiKey.trim(),
          Accept: "application/json",
        }
      : {
          Accept: "application/json",
        };

    if (!this.isOSTestnet() && config.openSeaApiUrl && config.openSeaNftApiKey) {
      headers["x-nft-api-key"] = config.openSeaNftApiKey;
    }

    try {
      const osResponse = await axios.get(!this.isOSTestnet() ? config.openSeaApiUrl || url : url, {
        headers,
      });

      switch (api) {
        case "events":
          // Fallback to offers API if we get a collection from the wrong chain
          if (network == osResponse.data.asset_events[0]?.asset.asset_contract.chain_identifier) {
            return osResponse.data.asset_events[0]?.asset;
          } else {
            return await this.getOSData("offers", contract, tokenId);
          }
        case "offers":
          return osResponse.data.orders[0]?.taker_asset_bundle.assets[0];
        case "asset":
        case "asset_contract":
        case "collection":
          return osResponse.data;
        case "nft":
          return osResponse.data.nft;
      }
    } catch (error: any) {
      this.handleError(error, `getOSData:${api}`, false);
    }
  }
}

export const openseaMetadataProvider = new OpenseaMetadataProvider();
