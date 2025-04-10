import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("Foundation", "Exchange");

export const DropMarket: ChainIdToAddress = resolveAddress("Foundation", "DropMarket");

export const MultiTokenDropMarket: ChainIdToAddress = resolveAddress(
  "Foundation",
  "MultiTokenDropMarket"
);
