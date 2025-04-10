import { ChainIdToAddress, resolveAddress } from "../utils";

export const DittoPoolFactory: ChainIdToAddress = resolveAddress("Ditto", "DittoPoolFactory");

export const LpNft: ChainIdToAddress = resolveAddress("Ditto", "LpNft");

export const DittoPoolRouter: ChainIdToAddress = resolveAddress("Ditto", "DittoPoolRouter");

export const DittoPoolRouterRoyalties: ChainIdToAddress = resolveAddress(
  "Ditto",
  "DittoPoolRouterRoyalties"
);

export const Test721: ChainIdToAddress = resolveAddress("Ditto", "Test721");

export const Test20: ChainIdToAddress = resolveAddress("Ditto", "Test20");

export const UpshotOracle: ChainIdToAddress = resolveAddress("Ditto", "UpshotOracle");
