import { Interface } from "@ethersproject/abi";

import { EventData } from "@/events-sync/data";

export const newContractInitialized: EventData = {
  kind: "magiceden",
  subKind: "magiceden-new-contract-initialized",
  topic: "0xa35e7914bdeb3c867652bf563a8fef465d3247bcbe2ee9563fe41acad61f01f9",
  numTopics: 1,
  addresses: {
    ["0x000000009e44eba131196847c685f20cd4b68ac4"]: true,
    ["0x00000000bea935f8315156894aa4a45d3c7a0075"]: true,
    ["0x4a08d3f6881c4843232efde05bacfb5eaab35d19"]: true,
    ["0x0000000000000000000000000000000000010000"]: true,
  },
  abi: new Interface([
    `event NewContractInitialized(address contractAddress, address initialOwner, uint32 implId, uint8 standard, string name, string symbol)`,
  ]),
};

export const publicStageSet: EventData = {
  kind: "magiceden",
  subKind: "magiceden-public-stage-set",
  topic: "0xbe59aad4e5e3cd0369b75babff1d2cf97c307e9d1ad1d4a7a22a32a8d0b9ed2a",
  numTopics: 1,
  abi: new Interface([`event PublicStageSet(uint256 startTime, uint256 endTime, uint256 price)`]),
};

export const maxSupplyUpdatedERC721: EventData = {
  kind: "magiceden",
  subKind: "magiceden-max-supply-updated-erc721",
  topic: "0x7810bd47de260c3e9ee10061cf438099dd12256c79485f12f94dbccc981e806c",
  numTopics: 1,
  abi: new Interface([`event MaxSupplyUpdated(uint32 newMaxSupply)`]),
};

export const walletLimitUpdatedERC721: EventData = {
  kind: "magiceden",
  subKind: "magiceden-wallet-limit-updated-erc721",
  topic: "0x199db6b3f784dbaaa5df3981a282a84eb13409a543eaaeb8e8f309c467b45e18",
  numTopics: 1,
  abi: new Interface([`event WalletLimitUpdated(uint32 _walletLimit)`]),
};

export const maxSupplyUpdatedERC1155: EventData = {
  kind: "magiceden",
  subKind: "magiceden-max-supply-updated-erc1155",
  topic: "0x708949a737b310dd5b3a011a4f5b1985f9ee4c69334aaa1613866e6f16f0334a",
  numTopics: 1,
  abi: new Interface([
    `event MaxSupplyUpdated(uint256 _tokenId, uint256 _oldMaxSupply, uint256 _newMaxSupply)`,
  ]),
};

export const walletLimitUpdatedERC1155: EventData = {
  kind: "magiceden",
  subKind: "magiceden-wallet-limit-updated-erc1155",
  topic: "0xc9aa851a9e693d868d2f64d4eda0e3480830af4a05b796fcbf27f8e8b58c18bc",
  numTopics: 1,
  abi: new Interface([`event WalletLimitUpdated(uint256 _tokenId, uint256 _walletLimit)`]),
};

export const royaltyInfoUpdated: EventData = {
  kind: "magiceden",
  subKind: "magiceden-royalty-info-updated",
  topic: "0xf21fccf4d64d86d532c4e4eb86c007b6ad57a460c27d724188625e755ec6cf6d",
  numTopics: 1,
  abi: new Interface([`event RoyaltyInfoUpdated(address receiver, uint256 bps)`]),
};
