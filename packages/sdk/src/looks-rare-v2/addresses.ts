import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("LooksRareV2", "Exchange");

export const TransferManager: ChainIdToAddress = resolveAddress("LooksRareV2", "TransferManager");

export const ProtocolFeeRecipient: ChainIdToAddress = resolveAddress(
  "LooksRareV2",
  "ProtocolFeeRecipient"
);
