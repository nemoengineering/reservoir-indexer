import {
  ChainIdToAddress,
  ChainIdToAddressList,
  resolveAddress,
  resolveAddressList,
} from "../utils";

// Native currency
export const Native: ChainIdToAddress = resolveAddress("Common", "Native");

// Wrapped native currency
export const WNative: ChainIdToAddress = resolveAddress("Common", "WNative");

export const Usdc: ChainIdToAddressList = resolveAddressList("Common", "Usdc");

export const Dai: ChainIdToAddress = resolveAddress("Common", "Dai");

export const RoyaltyEngine: ChainIdToAddress = resolveAddress("Common", "RoyaltyEngine");

// Uniswap's `SwapRouter02`
export const SwapRouter: ChainIdToAddress = resolveAddress("Common", "SwapRouter");

export const Create3Factory: ChainIdToAddress = resolveAddress("Common", "Create3Factory");

export const GelatoRelay1BalanceERC2771: ChainIdToAddress = resolveAddress(
  "Common",
  "GelatoRelay1BalanceERC2771"
);

export const GelatoRelay1BalanceConcurrentERC2771: ChainIdToAddress = resolveAddress(
  "Common",
  "GelatoRelay1BalanceConcurrentERC2771"
);

export const OpenseaTransferHelper: ChainIdToAddress = resolveAddress(
  "Common",
  "OpenseaTransferHelper"
);
