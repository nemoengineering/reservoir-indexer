import { Interface } from "@ethersproject/abi";

import { EventData } from "@/events-sync/data";

// v1 + v2 + v3

export const setTransferSecurityLevel: EventData = {
  kind: "erc721c",
  subKind: "erc721c-set-transfer-security-level",
  topic: "0xb39d8f1e6f05413a407e46fc950eb92e9f5b3d65a47c3f0bdc7a2741a6ec0f7d",
  numTopics: 2,
  abi: new Interface([
    `event SetTransferSecurityLevel(
      address indexed collection,
      uint8 level
    )`,
  ]),
};

export const transferValidatorUpdated: EventData = {
  kind: "erc721c",
  subKind: "erc721c-transfer-validator-updated",
  topic: "0xcc5dc080ff977b3c3a211fa63ab74f90f658f5ba9d3236e92c8f59570f442aac",
  numTopics: 1,
  abi: new Interface([
    `event TransferValidatorUpdated(
      address oldValidator,
      address newValidator
    )`,
  ]),
};

export const verifiedEOASignature: EventData = {
  kind: "erc721c",
  subKind: "erc721c-verified-eoa-signature",
  topic: "0xe7f8d62df5af850daa5d677e9e5c8065b7b549ec99ae61ba0ffaa9f5bf3e2d03",
  numTopics: 2,
  abi: new Interface([`event VerifiedEOASignature(address indexed account)`]),
};

// v1

export const addedToAllowlistV1: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v1-added-to-allowlist",
  topic: "0x611e962a89a9663f9e201204430468ed34f23cd95c1be59b66fa79cefa726b4f",
  numTopics: 4,
  abi: new Interface([
    `event AddedToAllowlist(
      uint8 indexed kind,
      uint256 indexed id,
      address indexed account
    )`,
  ]),
};

export const removedFromAllowlistV1: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v1-removed-from-allowlist",
  topic: "0x5d23e0e2d8347166058712ba9dceec21d6edd7b466a0d13cb759d730bd560390",
  numTopics: 4,
  abi: new Interface([
    `event RemovedFromAllowlist(
      uint8 indexed kind,
      uint256 indexed id,
      address indexed account
    )`,
  ]),
};

export const setAllowlistV1: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v1-set-allowlist",
  topic: "0x6e5a76d990dc6af893e20eb82ea37eac6f22cc50e7c7306275569cdc5421a543",
  numTopics: 4,
  abi: new Interface([
    `event SetAllowlist(
      uint8 indexed kind,
      address indexed collection,
      uint120 indexed id
    )`,
  ]),
};

// v2 + v3

export const addedAccountToListV2V3: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v2-v3-added-account-to-list",
  topic: "0xda8f3bd170446760f0f965a9b52bf271cb9679b5e0a70059eff2d49425229d17",
  numTopics: 4,
  abi: new Interface([
    `event AddedAccountToList(
      uint8 indexed kind,
      uint256 indexed id,
      address indexed account
    )`,
  ]),
};

export const addedCodeHashToListV2V3: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v2-v3-added-code-hash-to-list",
  topic: "0xc8615322788d404dfe307db9eef031bc148d1cec5e270a1fd6528a02b445d445",
  numTopics: 4,
  abi: new Interface([
    `event AddedCodeHashToList(
      uint8 indexed kind,
      uint256 indexed id,
      bytes32 indexed codehash
    )`,
  ]),
};

export const removedAccountFromListV2V3: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v2-v3-removed-account-from-list",
  topic: "0x503012490a650739416858609e898957b874d17415a062945179c57357978840",
  numTopics: 4,
  abi: new Interface([
    `event RemovedAccountFromList(
      uint8 indexed kind,
      uint256 indexed id,
      address indexed account
    )`,
  ]),
};

export const removedCodeHashFromListV2V3: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v2-v3-removed-code-hash-from-list",
  topic: "0x061d78094976b1d9ae7bb858f141c915b46152756409caadb07482983c2ca301",
  numTopics: 4,
  abi: new Interface([
    `event RemovedCodeHashFromList(
      uint8 indexed kind,
      uint256 indexed id,
      bytes32 indexed codehash
    )`,
  ]),
};

export const appliedListToCollectionV2V3: EventData = {
  kind: "erc721c",
  subKind: "erc721c-v2-v3-applied-list-to-collection",
  topic: "0xa66ff5557b7dc1562bb5e83306e15b513a25aa7537369bce38fc29c20847a791",
  numTopics: 3,
  abi: new Interface([
    `event AppliedListToCollection(
      address indexed collection,
      uint120 indexed id
    )`,
  ]),
};
