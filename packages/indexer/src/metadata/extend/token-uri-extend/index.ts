/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";

export const extendTokenUri = async (
  { contract, tokenId }: { contract: string; tokenId: string },
  uri: string
) => {
  let _uri = uri;

  if (
    config.chainId === 8453 &&
    [
      "0x822d97e3294c405f7c0abc0ba271e6cd1f025570",
      "0x7c00170161a557c2547467f2d9474e514d162885",
      "0xd2235a29766125aebaf13e862c01e2ec8b0a6fb0",
      "0x4836496a26aaf39f8a0a7ba69500a931fa059129",
    ].includes(contract)
  ) {
    const urlParts = uri.split("/");
    const tokenIdPart = urlParts[urlParts.length - 1];

    _uri = uri.replace(tokenIdPart, tokenId);
  }

  if (
    config.chainId === 137 &&
    [
      "0xe7b93ca2c024220cbd94d47d5dda8b6e51dc4b7f",
      "0x5bc41bbb137ee85eea4ede5961faf42fce40cc6f",
      "0x2e469931f02bf8807d004fc26ea8fd815e3b5fbc",
      "0x2a0fc65ca5d439860377849d2918609b22472349",
      "0x6416bff8b8776d94749b73e501f64bcb25d6e9f2",
      "0xbb10ed4b6675013eb91b5926baa66669868d6723",
      "0x53973c9913943a884669ca3314ff99237f531706",
      "0xcac387a146bb476a4034fb6584c8ed121aa0b9c2",
    ].includes(contract)
  ) {
    const urlParts = uri.split("/");
    const tokenIdPart = urlParts[urlParts.length - 1];

    _uri = uri.replace(tokenIdPart, tokenId);
  }

  if (
    config.chainId === 80094 &&
    ["0xa0cf472e6132f6b822a944f6f31aa7b261c7c375"].includes(contract)
  ) {
    if (!uri.endsWith(".json")) {
      _uri = `${uri}.json`;
    }
  }

  return _uri;
};
