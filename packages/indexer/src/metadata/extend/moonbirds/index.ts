/* eslint-disable @typescript-eslint/no-explicit-any */

import { TokenMetadata } from "@/metadata/types";

import axios from "axios";

export const extend = async (metadata: TokenMetadata) => {
  // get extra meta data from MB API
  const url = `https://birdwatching.moonbirds.xyz/moonbirds/${metadata.tokenId}`;
  const { data } = await axios.get(url, {});

  if (!data.moonbird) {
    throw new Error("Missing Moonbird");
  }

  const nested = data.moonbird.nesting.nested;
  const nestLevel = data.moonbird.nesting.nestLevel;
  const eyeColor = data.moonbird.traits.eyeColor;

  let imageUrl = `https://proof-nft-image.imgix.net/${metadata.contract}/${metadata.tokenId}`;

  if (metadata.animationOriginalUrl) {
    const animationOriginalUrl = new URL(metadata.animationOriginalUrl);

    const useNewArtwork = animationOriginalUrl.searchParams.get("useNewArtwork");

    if (useNewArtwork === "true") {
      imageUrl = `https://collection-assets.proof.xyz/moonbirds/images/${metadata.tokenId}.png`;
    } else {
      imageUrl = `https://moonbirds-image.proof.xyz/${metadata.tokenId}?scaleupFactor=18`;
    }
  }

  return {
    ...metadata,
    imageUrl,
    imageOriginalUrl: imageUrl,
    attributes: [
      ...metadata.attributes,
      {
        key: "Trait Count",
        value: metadata.attributes.length,
        kind: "string",
        rank: 2,
      },
      {
        key: "Nested",
        value: nested,
        kind: "string",
        rank: 1,
      },
      {
        key: "Nest Level",
        value: nestLevel,
        kind: "string",
        rank: 1,
      },
      {
        key: "Eye Color",
        value: eyeColor,
        kind: "string",
        rank: 1,
      },
    ],
  };
};
