import { ChainIdToAddress, Network, resolveAddress } from "../utils";

export const SplitMain: ChainIdToAddress = resolveAddress("ZeroExSplits", "SplitMain");

export const SplitWallet: ChainIdToAddress = resolveAddress("ZeroExSplits", "SplitWallet");

export const getInitCode = (network: Network) =>
  `0x3d605d80600a3d3981f336603057343d52307f830d2d700a97af574b186c80d40429385d24241565b08a7c559ba283a964d9b160203da23d3df35b3d3d3d3d363d3d37363d73${SplitWallet[
    network
  ].slice(2)}5af43d3d93803e605b57fd5bf3`;

export const SplitWalletInitCode: ChainIdToAddress = resolveAddress(
  "ZeroExSplits",
  "SplitWalletInitCode"
);
