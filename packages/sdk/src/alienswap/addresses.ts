import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("Alienswap", "Exchange");

export const AlienswapConduitKey: ChainIdToAddress = resolveAddress(
  "Alienswap",
  "AlienswapConduitKey"
);
