import { Interface } from "@ethersproject/abi";
import { PaymentProcessorBase } from "@reservoir0x/sdk";

import { config } from "@/config/index";
import { EventData } from "@/events-sync/data";

const abi = new Interface([
  `event PaymentMethodAddedToWhitelist(
    uint32 indexed paymentMethodWhitelistId,
    address indexed paymentMethod
  )`,
  `event PaymentMethodRemovedFromWhitelist(
    uint32 indexed paymentMethodWhitelistId,
    address indexed paymentMethod
  )`,
  `event TrustedChannelAddedForCollection(
    address indexed tokenAddress, 
    address indexed channel
  )`,
  `event TrustedChannelRemovedForCollection(
    address indexed tokenAddress,
    uint256 indexed channel
  )`,
  `event UpdatedTokenLevelPricingBoundaries(
    address indexed tokenAddress,
    uint256 indexed tokenId,
    uint256 floorPrice,
    uint256 ceilingPrice
  )`,
  `event UpdatedCollectionPaymentSettings(
    address indexed tokenAddress,
    (
      uint8 paymentSettings,
      uint32 paymentMethodWhitelistId,
      address constrainedPricingPaymentMethod,
      uint16 royaltyBackfillNumerator,
      address royaltyBackfillReceiver,
      uint16 royaltyBountyNumerator,
      address exclusiveBountyReceiver,
      uint16 extraData,
      uint256 gasLimitOverride,
      uint120 collectionMinimumFloorPrice,
      uint120 collectionMaximumCeilingPrice
    ) params
  )`,
]);

export const paymentMethodAddedToWhitelist: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-payment-method-added-to-whitelist",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("PaymentMethodAddedToWhitelist"),
  numTopics: 3,
  abi,
};

export const paymentMethodRemovedFromWhitelist: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-payment-method-removed-from-whitelist",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("PaymentMethodRemovedFromWhitelist"),
  numTopics: 3,
  abi,
};

export const updatedCollectionPaymentSettings: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-updated-collection-payment-settings",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("UpdatedCollectionPaymentSettings"),
  numTopics: 2,
  abi,
};

export const updatedTokenLevelPricingBoundaries: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-updated-token-level-pricing-boundaries",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("UpdatedTokenLevelPricingBoundaries"),
  numTopics: 3,
  abi,
};

export const trustedChannelAddedForCollection: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-trusted-channel-added-for-collection",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("TrustedChannelAddedForCollection"),
  numTopics: 3,
  abi,
};

export const trustedChannelRemovedForCollection: EventData = {
  kind: "payment-processor-registry",
  subKind: "payment-processor-registry-trusted-channel-removed-for-collection",
  addresses: {
    [PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId]?.toLowerCase()]:
      true,
  },
  topic: abi.getEventTopic("TrustedChannelRemovedForCollection"),
  numTopics: 3,
  abi,
};
