import { ChainIdToAddress, resolveAddress } from "../utils";

export const VaultFactory: ChainIdToAddress = resolveAddress("Nftx", "VaultFactory");

export const MarketplaceZap: ChainIdToAddress = resolveAddress("Nftx", "MarketplaceZap");

export const ZeroExMarketplaceZap: ChainIdToAddress = resolveAddress(
  "Nftx",
  "ZeroExMarketplaceZap"
);

export const NFTXStakingZap: ChainIdToAddress = resolveAddress("Nftx", "NFTXStakingZap");

export const SushiRouter: ChainIdToAddress = resolveAddress("Nftx", "SushiRouter");
