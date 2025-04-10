import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("ZeroExV4", "Exchange");

export const Native: ChainIdToAddress = resolveAddress("ZeroExV4", "Native");

export const TokenRangeValidator: ChainIdToAddress = resolveAddress(
  "ZeroExV4",
  "TokenRangeValidator"
);

export const BitVectorValidator: ChainIdToAddress = resolveAddress(
  "ZeroExV4",
  "BitVectorValidator"
);

export const PackedListValidator: ChainIdToAddress = resolveAddress(
  "ZeroExV4",
  "PackedListValidator"
);
