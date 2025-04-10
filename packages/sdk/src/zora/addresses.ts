import { ChainIdToAddress, resolveAddress } from "../utils";

export const ERC1155Factory: ChainIdToAddress = resolveAddress("Zora", "ERC1155Factory");

export const ERC1155FactoryV2: ChainIdToAddress = resolveAddress("Zora", "ERC1155FactoryV2");

export const ERC1155ZoraMerkleMinter: ChainIdToAddress = resolveAddress(
  "Zora",
  "ERC1155ZoraMerkleMinter"
);

export const ERC1155ZoraFixedPriceEMinter: ChainIdToAddress = resolveAddress(
  "Zora",
  "ERC1155ZoraFixedPriceEMinter"
);

export const ZoraTimedSaleStrategy: ChainIdToAddress = resolveAddress(
  "Zora",
  "ZoraTimedSaleStrategy"
);

export const Preminter: ChainIdToAddress = resolveAddress("Zora", "Preminter");
