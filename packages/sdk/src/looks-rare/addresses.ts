import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("LooksRare", "Exchange");

export const StrategyStandardSaleDeprecated: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "StrategyStandardSaleDeprecated"
);

export const StrategyStandardSale: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "StrategyStandardSale"
);

export const StrategyCollectionSaleDeprecated: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "StrategyCollectionSaleDeprecated"
);

export const StrategyCollectionSale: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "StrategyCollectionSale"
);

export const TransferManagerErc721: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "TransferManagerErc721"
);

export const TransferManagerErc1155: ChainIdToAddress = resolveAddress(
  "LooksRare",
  "TransferManagerErc1155"
);
