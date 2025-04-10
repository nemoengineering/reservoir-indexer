import { ChainIdToAddress, resolveAddress } from "../utils";

export const PairFactory: ChainIdToAddress = resolveAddress("Sudoswap", "PairFactory");

export const Router: ChainIdToAddress = resolveAddress("Sudoswap", "Router");

export const RouterWithRoyalties: ChainIdToAddress = resolveAddress(
  "Sudoswap",
  "RouterWithRoyalties"
);

export const LinearCurve: ChainIdToAddress = resolveAddress("Sudoswap", "LinearCurve");

export const ExponentialCurve: ChainIdToAddress = resolveAddress("Sudoswap", "ExponentialCurve");

export const XykCurve: ChainIdToAddress = resolveAddress("Sudoswap", "XykCurve");

export const LSSVMRouter: ChainIdToAddress = resolveAddress("Sudoswap", "LSSVMRouter");
