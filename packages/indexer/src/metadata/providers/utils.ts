/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from "@/common/logger";
import { Collection, CollectionMetadata, MapEntry, Metadata } from "../types";
import { config } from "@/config/index";
import { Contract } from "ethers";
import { Interface } from "ethers/lib/utils";
import { baseProvider } from "@/common/provider";

export const normalizeLink = (
  link: string,
  validatePrefix = true,
  ipfsGateway?: "ipfs" | "pinata"
) => {
  let gatewayBaseUrl = "https://ipfs.io/ipfs";
  if (ipfsGateway === "pinata") {
    gatewayBaseUrl = "https://gateway.pinata.cloud/ipfs";
  }

  if (link && link.startsWith("ipfs://ipfs/")) {
    return `${gatewayBaseUrl}/${link.slice(12)}`;
  }

  if (link && link.startsWith("ipfs://")) {
    return `${gatewayBaseUrl}/${link.slice(7)}`;
  }

  if (link && link.startsWith("ipfs/")) {
    return `${gatewayBaseUrl}/${link.slice(5)}`;
  }

  if (link && link === "null") {
    return "";
  }

  if (link && link.startsWith("/")) {
    return "";
  }

  if (link && link.startsWith("''/")) {
    return "";
  }

  if (link && link.startsWith("ar://")) {
    return link.replace("ar://", "https://arweave.net/");
  }

  // link = normalizeNftStorageLink(link);

  const validPrefixes = ["http", "data:image"];

  if (link && validatePrefix && !validPrefixes.some((prefix) => link?.startsWith(prefix))) {
    logger.info(
      "onchain-fetcher",
      JSON.stringify({
        topic: "tokenMetadataIndexing",
        message: `invalidPrefix. link=${link}`,
      })
    );

    return null;
  }

  return link?.trim();
};

export const normalizeNftStorageLink = (link: string) => {
  link = link?.split("?ext=")[0];

  const nftStorageLinkMatch = link?.match(/^(http)s?:\/\/(.*?)\.ipfs\.nftstorage\.link\/(.*?)$/);

  if (nftStorageLinkMatch) {
    link = `https://ipfs.io/ipfs/${nftStorageLinkMatch[2]}/${nftStorageLinkMatch[3]}`;
  }

  return link;
};

export const normalizeCollectionMetadata = (
  collection: Collection,
  ipfsGateway?: "ipfs" | "pinata"
): Metadata => {
  if (!collection) {
    return {};
  }

  const map: Record<string, MapEntry> = {
    discord: {
      key: "discordUrl",
    },
    discord_url: {
      key: "discordUrl",
    },
    twitter_username: {
      key: "twitterUsername",
      normalize: (value: string) => {
        // if the value is a url, return the username
        if (value?.includes("twitter.com") || value?.includes("x.com")) {
          return value.split("/")[3];
        }

        return value;
      },
    },
    twitter: {
      key: "twitterUrl",
      normalize: (value: string) => {
        if (value?.includes("twitter.com") || value?.includes("x.com")) {
          return value;
        }
        // if the value is a username, return the url
        return `https://x.com/${value}`;
      },
    },
    telegram: {
      key: "telegramUrl",
      normalize: (value: string) => {
        if (value?.includes("t.me")) {
          return value;
        }

        return `https://t.me/${value}`;
      },
    },
    instagram: {
      key: "instagramUrl",
      normalize: (value: string) => {
        if (value?.includes("instagram.com")) {
          return value;
        }
        return `https://instagram.com/${value}`;
      },
    },
    medium: {
      key: "mediumUrl",
    },
    github: {
      key: "githubUrl",
    },
    website: {
      key: "externalUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    website_url: {
      key: "externalUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    external_url: {
      key: "externalUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    external_link: {
      key: "externalUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    project_url: {
      // From Opensea V2 APIs
      key: "externalUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    image: {
      key: "imageUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    image_url: {
      key: "imageUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    cover_image: {
      key: "bannerImageUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    banner_image_url: {
      key: "bannerImageUrl",
      normalize: (value: string) => normalizeLink(value, true, ipfsGateway),
    },
    safelist_request_status: {
      key: "safelistRequestStatus",
    },
    safelist_status: {
      // From Opensea V2 APIs
      key: "safelistRequestStatus",
    },
    name: {
      key: "name",
    },
    description: {
      key: "description",
    },
    mintConfig: {
      key: "mintConfig",
    },
  };

  const metadata: Metadata = {};
  if (collection?.social_urls) {
    Object.keys(collection.social_urls).forEach((key) => {
      const mapKey = map[key];
      if (mapKey) {
        if (mapKey.normalize && collection.social_urls && collection.social_urls[key]) {
          metadata[mapKey.key] = mapKey.normalize(collection.social_urls[key]);
        } else if (collection.social_urls && collection.social_urls[key]) {
          metadata[mapKey.key] = collection.social_urls[key];
        }
      }
    });
  }

  // // do the above via the map
  Object.keys(map).forEach((key) => {
    const mapKey = map[key];
    if (mapKey && key in collection) {
      const collectionKey = collection[key as keyof Collection];
      if (mapKey.normalize && collectionKey) {
        // Check for normalize function before invoking
        const normalizedValue = mapKey.normalize ? mapKey.normalize(collectionKey) : undefined;
        if (normalizedValue) {
          metadata[mapKey.key] = normalizedValue;
        }
      } else {
        metadata[mapKey.key] = collectionKey;
      }
    }
  });

  Object.keys(map).forEach((key) => {
    const mapKey = map[key];
    if (key in collection) {
      const collectionKey = collection[key as keyof Collection];
      if (mapKey.normalize) {
        metadata[mapKey.key] = mapKey.normalize(collectionKey);
      } else {
        metadata[mapKey.key] = collectionKey;
      }
    }
  });

  return metadata;
};

export class RequestWasThrottledError extends Error {
  delay = 0;

  constructor(message: string, delay: number) {
    super(message);
    this.delay = delay;

    Object.setPrototypeOf(this, RequestWasThrottledError.prototype);
  }
}

export class TokenUriRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, TokenUriRequestTimeoutError.prototype);
  }
}

export class TokenUriNotFoundError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, TokenUriNotFoundError.prototype);
  }
}

export class TokenUriRequestForbiddenError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, TokenUriRequestForbiddenError.prototype);
  }
}

export class CollectionNotFoundError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, CollectionNotFoundError.prototype);
  }
}

export function limitFieldSize(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  key: string,
  contract: string,
  tokenId: string,
  method: string
) {
  try {
    let size = 0;
    if (typeof value === "string") {
      size = new TextEncoder().encode(value).length;
    } else {
      size = new TextEncoder().encode(JSON.stringify(value)).length;
    }

    if (size > config.metadataMaxFieldSizeMB * 1024 * 1024) {
      logger.info(
        "limitFieldSize",
        JSON.stringify({
          size: new TextEncoder().encode(value).length,
          key: key,
          contract: contract,
          tokenId: tokenId,
          method: method,
          value: value,
        })
      );
    }
    return size > config.metadataMaxFieldSizeMB * 1024 * 1024 ? null : value;
  } catch (error) {
    logger.error("limitFieldSize", `Error: ${error}`);
    return value;
  }
}

export function handleTokenUriResponse(contract: string, tokenId: string, response: any) {
  if (response.data !== null) {
    const contentType = response.headers["content-type"];

    if (contentType && contentType.startsWith("image")) {
      if (response.config.url) {
        return [
          {
            image: response.config.url.replace(config.ipfsGatewayDomain, "ipfs.io"),
          },
          null,
        ];
      }

      return [null, "Image as TokenUri"];
    }

    if (typeof response.data === "object") {
      if (
        config.chainId === 1 &&
        contract === "0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401" &&
        "message" in response.data
      ) {
        return [null, 404];
      }

      return [response.data, null];
    } else {
      try {
        const responseData = response.data.replace(/,\s*([}\]])/g, "$1");
        return [JSON.parse(responseData), null];
      } catch {
        // Do nothing
      }
    }
  }

  return [null, "Invalid JSON"];
}

export function handleTokenUriErrorResponse(
  contract: string,
  tokenId: string,
  error: any,
  context?: string
) {
  logger.log(
    config.debugMetadataIndexingCollections.includes(contract) ? "warn" : "debug",
    "onchain-fetcher",
    JSON.stringify({
      topic: "tokenMetadataIndexing",
      message: `handleTokenUriErrorResponse. contract=${contract}, tokenId=${tokenId}, url=${error.config.url}, responseStatus=${error.response?.status}, context=${context}`,
      contract,
      tokenId,
      error: JSON.stringify(error),
      errorResponseStatus: error.response?.status,
      errorResponseData: error.response?.data,
      debugMetadataIndexingCollection: true,
    })
  );

  return [null, error.response?.status || error.code || `${error}`];
}

export async function generateFallbackCollectionMetadata(
  contract: string,
  fallbackReason?: string
): Promise<CollectionMetadata> {
  let name = contract;

  try {
    name = await new Contract(
      contract,
      new Interface(["function name() view returns (string)"]),
      baseProvider
    ).name();
  } catch (error) {
    // Skip errors
  }

  return {
    id: contract,
    slug: null,
    name,
    community: null,
    metadata: null,
    contract,
    tokenIdRange: null,
    tokenSetId: `contract:${contract}`,
    isFallback: true,
    fallbackReason,
  };
}
