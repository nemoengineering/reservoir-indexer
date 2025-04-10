import { Interface } from "@ethersproject/abi";

import { EventData } from "@/events-sync/data";
import { config } from "@/config/index";
import * as Sdk from "@reservoir0x/sdk";

export const contractCreated: EventData = {
  kind: "coinbase",
  subKind: "coinbase-contract-created",
  topic: "0x2d49c67975aadd2d389580b368cfff5b49965b0bd5da33c144922ce01e7a4d7b",
  numTopics: 3,
  addresses: {
    [Sdk.Coinbase.Addresses.MintFactory[config.chainId]]: true,
    [Sdk.Coinbase.Addresses.GalleryMintFactory[config.chainId]]: true,
  },
  abi: new Interface([
    `event ContractCreated(address indexed contractAddress, address indexed minter)`,
  ]),
};
