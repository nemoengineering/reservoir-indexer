import { ChainIdToAddress, resolveAddress } from "../utils";

export const VaultFactory: ChainIdToAddress = resolveAddress("NftxV3", "VaultFactory");

export const MarketplaceZap: ChainIdToAddress = resolveAddress("NftxV3", "MarketplaceZap");

export const NFTXUniversalRouter: ChainIdToAddress = resolveAddress(
  "NftxV3",
  "NFTXUniversalRouter"
);

export const CreateVaultZap: ChainIdToAddress = resolveAddress("NftxV3", "CreateVaultZap");

export const QuoterV2: ChainIdToAddress = resolveAddress("NftxV3", "QuoterV2");
