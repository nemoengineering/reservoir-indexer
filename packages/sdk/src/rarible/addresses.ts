import { ChainIdToAddress, resolveAddress } from "../utils";

export const Exchange: ChainIdToAddress = resolveAddress("Rarible", "Exchange");

export const NFTTransferProxy: ChainIdToAddress = resolveAddress("Rarible", "NFTTransferProxy");

export const ERC20TransferProxy: ChainIdToAddress = resolveAddress("Rarible", "ERC20TransferProxy");

export const ExchangeV1: ChainIdToAddress = resolveAddress("Rarible", "ExchangeV1");
