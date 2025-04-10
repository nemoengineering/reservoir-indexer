/* eslint-disable @typescript-eslint/no-explicit-any */

import axios from "axios";

export const fetchToken = async ({ contract, tokenId }: { contract: string; tokenId: string }) => {
  const url = `https://dojicrew.s3.amazonaws.com/metadata/${tokenId}`;
  const { data } = await axios.get(url);

  return {
    contract,
    tokenId,
    collection: contract,
    name: data.name,
    description: data.description,
    imageUrl: data.image,
    animationOriginalUrl: data.animation_url || null,
    imageOriginalUrl: data.image,
    metadataOriginalUrl: url,
    attributes: data.attributes.map((attribute: any) => {
      return {
        key: attribute.trait_type || "property",
        value: attribute.value,
        kind: typeof attribute.value == "number" ? "number" : "string",
        rank: 1,
      };
    }),
  };
};
