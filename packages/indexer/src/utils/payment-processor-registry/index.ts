import { Interface, Result } from "@ethersproject/abi";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import * as Sdk from "@reservoir0x/sdk";
import _ from "lodash";

import { baseProvider } from "@/common/provider";
import { redis } from "@/common/redis";
import { config } from "@/config/index";
import { Royalty, refreshDefaultRoyalties, updateRoyaltySpec } from "@/utils/royalties";

export enum PaymentSettings {
  Default = 0,
  Any = 1,
  Custom = 2,
  PricingConstraintsCollectionOnly = 3,
  PricingConstraints = 4,
  Paused = 5,
}

export type CollectionPaymentSettings = {
  paymentSettings: PaymentSettings;
  constrainedPricingPaymentMethod: string;
  royaltyBackfillNumerator: number;
  royaltyBackfillReceiver: string;
  royaltyBountyNumerator: number;
  pricingBounds?: PricingBounds;
  whitelistedPaymentMethods: string[];
};

export type TrustedChannel = {
  channel: string;
  signer: string;
};

export type PricingBounds = {
  floorPrice: string;
  ceilingPrice: string;
};

// Collection configuration

export const getConfigByContract = async (
  paymentProcessor: string,
  contract: string,
  refresh?: boolean
): Promise<CollectionPaymentSettings | undefined> => {
  const cacheKey = `pp-registry-config-by-contract:${paymentProcessor}:${contract}`;

  let result = await redis
    .get(cacheKey)
    .then((r) => (r ? (JSON.parse(r) as CollectionPaymentSettings) : undefined));
  if (!result || refresh) {
    try {
      const exchange = new Contract(
        Sdk.PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId],
        new Interface([
          `function getCollectionSettings(
            address tokenAddress,
            bytes32[] dataExtensions,
            bytes32[] wordExtensions
          ) view returns (
            (
              bool initialized,
              uint8 paymentSettingsType,
              uint32 paymentMethodWhitelistId,
              address royaltyBackfillReceiver,
              uint16 royaltyBackfillNumerator,
              uint16 royaltyBountyNumerator,
              uint16 extraData
            ) collectionCoreSettings,
            (
              bool isSet,
              uint120 floorPrice,
              uint120 ceilingPrice
            ) collectionPricingBounds,
            address constrainedPricingPaymentMethod,
            address exclusiveBountyReceiver,
            uint256 gasLimitOverride,
            bytes[] data,
            bytes32[] words
          )`,
        ]),
        baseProvider
      );

      const settings = await exchange.getCollectionSettings(contract, [], []);

      result = {
        paymentSettings: settings.collectionCoreSettings.paymentSettingsType,
        constrainedPricingPaymentMethod: settings.constrainedPricingPaymentMethod.toLowerCase(),
        royaltyBackfillNumerator: settings.collectionCoreSettings.royaltyBackfillNumerator,
        royaltyBountyNumerator: settings.collectionCoreSettings.royaltyBountyNumerator,
        royaltyBackfillReceiver:
          settings.collectionCoreSettings.royaltyBackfillReceiver.toLowerCase(),
        whitelistedPaymentMethods:
          settings.collectionCoreSettings.paymentSettingsType === PaymentSettings.Default
            ? await getDefaultPaymentMethods(paymentProcessor)
            : await getPaymentMethods(
                settings.collectionCoreSettings.paymentMethodWhitelistId,
                refresh
              ),
      };

      if (
        result?.paymentSettings === PaymentSettings.PricingConstraints ||
        result?.paymentSettings === PaymentSettings.PricingConstraintsCollectionOnly
      ) {
        result.pricingBounds = {
          floorPrice: settings.collectionPricingBounds.floorPrice.toString(),
          ceilingPrice: settings.collectionPricingBounds.ceilingPrice.toString(),
        };
      }

      if (result) {
        await redis.set(cacheKey, JSON.stringify(result), "EX", 3 * 3600);
      }
    } catch {
      // Skip errors
    }
  }

  return result;
};

// Trusted channels

export const getTrustedChannels = async (contract: string, refresh?: boolean) => {
  const cacheKey = `pp-registry-trusted-channels:${contract}`;

  let result = await redis
    .get(cacheKey)
    .then((r) => (r ? (JSON.parse(r) as TrustedChannel[]) : undefined));
  if (!result || refresh) {
    try {
      const exchange = new Contract(
        Sdk.PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId],
        new Interface(["function getTrustedChannels(address token) view returns (address[])"]),
        baseProvider
      );

      const trustedChannels = await exchange.getTrustedChannels(contract);
      const trustedChannelsWithSigners: {
        channel: string;
        signer: string;
      }[] = [];

      await Promise.all(
        trustedChannels
          .map((c: Result) => c.toLowerCase())
          .map(async (channel: string) => {
            try {
              const channelContract = new Contract(
                channel,
                new Interface(["function signer() view returns (address)"]),
                baseProvider
              );

              const signer = await channelContract.callStatic.signer();
              trustedChannelsWithSigners.push({
                channel: channel.toLowerCase(),
                signer: signer.toLowerCase(),
              });
            } catch {
              // Skip errors
            }
          })
      );

      result = trustedChannelsWithSigners;
      await redis.set(cacheKey, JSON.stringify(result), "EX", 3 * 3600);
    } catch {
      // Skip errors
    }
  }

  return result ?? [];
};

// Payment methods

export const getDefaultPaymentMethods = async (paymentProcessor: string): Promise<string[]> => {
  const cacheKey = `pp-registry-default-payment-methods:${paymentProcessor}`;

  let result = await redis.get(cacheKey).then((r) => (r ? (JSON.parse(r) as string[]) : undefined));
  if (!result) {
    const exchange = new Contract(
      paymentProcessor,
      new Interface(["function getDefaultPaymentMethods() view returns (address[])"]),
      baseProvider
    );

    result = await exchange
      .getDefaultPaymentMethods()
      .then((c: Result) => c.map((d) => d.toLowerCase()));
    await redis.set(cacheKey, JSON.stringify(_.uniq(result)), "EX", 7 * 24 * 3600);
  }

  return result!;
};

export const getPaymentMethods = async (paymentMethodWhitelistId: number, refresh?: boolean) => {
  const cacheKey = `pp-registry-payment-methods:${paymentMethodWhitelistId}`;

  let result = await redis.get(cacheKey).then((r) => (r ? (JSON.parse(r) as string[]) : undefined));
  if (!result || refresh) {
    try {
      const exchange = new Contract(
        Sdk.PaymentProcessorBase.Addresses.CollectionSettingsRegistry[config.chainId],
        new Interface([
          "function getWhitelistedPaymentMethods(uint32 paymentMethodWhitelistId) view returns (address[])",
        ]),
        baseProvider
      );

      result = await exchange
        .getWhitelistedPaymentMethods(paymentMethodWhitelistId)
        .then((c: Result) => c.map((d) => d.toLowerCase()));
      await redis.set(cacheKey, JSON.stringify(result), "EX", 3 * 3600);
    } catch {
      // Skip errors
    }
  }

  return result ?? [];
};

// Backfilled royalties

export const saveBackfilledRoyalties = async (tokenAddress: string, royalties: Royalty[]) => {
  await updateRoyaltySpec(
    tokenAddress,
    "pp-registry-backfill",
    royalties.some((r) => r.recipient !== AddressZero) ? royalties : undefined
  );
  await refreshDefaultRoyalties(tokenAddress);
};
