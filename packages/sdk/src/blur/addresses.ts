import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("Blur", "Exchange");

export const StandardPolicyERC721: ChainIdToAddress = resolveAddress(
  "Blur",
  "StandardPolicyERC721"
);

export const StandardPolicyERC721_V2: ChainIdToAddress = resolveAddress(
  "Blur",
  "StandardPolicyERC721_V2"
);

export const ExecutionDelegate: ChainIdToAddress = resolveAddress("Blur", "ExecutionDelegate");

export const Beth: ChainIdToAddress = resolveAddress("Blur", "Beth");

export const OperatorFilterRegistry: ChainIdToAddress = resolveAddress(
  "Blur",
  "OperatorFilterRegistry"
);
