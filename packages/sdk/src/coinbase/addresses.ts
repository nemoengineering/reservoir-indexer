import { ChainIdToAddress, resolveAddress } from "../utils";

export const MintFactory: ChainIdToAddress = resolveAddress("Coinbase", "MintFactory");

export const GalleryMintFactory: ChainIdToAddress = resolveAddress(
  "Coinbase",
  "GalleryMintFactory"
);
