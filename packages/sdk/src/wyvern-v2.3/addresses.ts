import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("WyvernV23", "Exchange");

export const ProxyRegistry: ChainIdToAddress = resolveAddress("WyvernV23", "ProxyRegistry");

export const TokenTransferProxy: ChainIdToAddress = resolveAddress(
  "WyvernV23",
  "TokenTransferProxy"
);

export const TokenListVerifier: ChainIdToAddress = resolveAddress("WyvernV23", "TokenListVerifier");

export const TokenRangeVerifier: ChainIdToAddress = resolveAddress(
  "WyvernV23",
  "TokenRangeVerifier"
);

export const OpenSeaMekleValidator: ChainIdToAddress = resolveAddress(
  "WyvernV23",
  "OpenSeaMekleValidator"
);
