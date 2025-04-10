import { Interface } from "@ethersproject/abi";
import { PaymentProcessorV21 } from "@reservoir0x/sdk";

import { config } from "@/config/index";
import { EventData } from "@/events-sync/data";

const abi = new Interface([
  `event BuyListingERC721(
    address indexed buyer,
    address indexed seller,
    address indexed tokenAddress,
    address beneficiary,
    address paymentCoin,
    uint256 tokenId,
    uint256 salePrice
  )`,
  `event BuyListingERC1155(
    address indexed buyer,
    address indexed seller,
    address indexed tokenAddress,
    address beneficiary,
    address paymentCoin,
    uint256 tokenId,
    uint256 amount,
    uint256 salePrice
  )`,
  `event AcceptOfferERC721(
    address indexed seller,
    address indexed buyer,
    address indexed tokenAddress,
    address beneficiary,
    address paymentCoin,
    uint256 tokenId,
    uint256 salePrice
  )`,
  `event AcceptOfferERC1155(
    address indexed seller,
    address indexed buyer,
    address indexed tokenAddress,
    address beneficiary,
    address paymentCoin,
    uint256 tokenId,
    uint256 amount,
    uint256 salePrice
  )`,
  `event MasterNonceInvalidated(
    address indexed account,
    uint256 nonce
  )`,
  `event NonceInvalidated(
    uint256 indexed nonce,
    address indexed account,
    bool wasCancellation
  )`,
  `event OrderDigestInvalidated(
    bytes32 indexed orderDigest,
    address indexed account,
    bool wasCancellation
  )`,
  `event NonceRestored(
    uint256 indexed nonce, 
    address indexed account
  )`,
  `event OrderDigestItemsRestored(
    bytes32 indexed orderDigest, 
    address indexed account, 
    uint248 amountRestoredToOrder
  )`,
]);

export const buyListingERC721: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-buy-listing-erc721",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("BuyListingERC721"),
  numTopics: 4,
  abi,
};

export const buyListingERC1155: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-buy-listing-erc1155",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("BuyListingERC1155"),
  numTopics: 4,
  abi,
};

export const acceptOfferERC721: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-accept-offer-erc721",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("AcceptOfferERC721"),
  numTopics: 4,
  abi,
};

export const acceptOfferERC1155: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-accept-offer-erc1155",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("AcceptOfferERC1155"),
  numTopics: 4,
  abi,
};

export const masterNonceInvalidated: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-master-nonce-invalidated",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("MasterNonceInvalidated"),
  numTopics: 2,
  abi,
};

export const nonceInvalidated: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-nonce-invalidated",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("NonceInvalidated"),
  numTopics: 3,
  abi,
};

export const orderDigestInvalidated: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-order-digest-invalidated",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("OrderDigestInvalidated"),
  numTopics: 3,
  abi,
};

export const nonceRestored: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-nonce-restored",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("NonceRestored"),
  numTopics: 3,
  abi,
};

export const orderDigestItemsRestored: EventData = {
  kind: "payment-processor-v2.1",
  subKind: "payment-processor-v2.1-order-digest-items-restored",
  addresses: { [PaymentProcessorV21.Addresses.Exchange[config.chainId]?.toLowerCase()]: true },
  topic: abi.getEventTopic("OrderDigestItemsRestored"),
  numTopics: 3,
  abi,
};
