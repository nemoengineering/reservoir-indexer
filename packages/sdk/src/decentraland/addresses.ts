import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("Decentraland", "Exchange");

export const ExchangeCurrency: ChainIdToAddress = resolveAddress(
  "Decentraland",
  "ExchangeCurrency"
);
