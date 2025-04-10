import * as Sdk from "@reservoir0x/sdk";

import { config } from "@/config/index";
import { getEventData } from "@/events-sync/data";
import { EnhancedEvent } from "@/events-sync/handlers/utils";
import * as paymentProcessorRegistryUtils from "@/utils/payment-processor-registry";

export const handleEvents = async (events: EnhancedEvent[]) => {
  // Handle the events
  for (const { subKind, log } of events) {
    const eventData = getEventData([subKind])[0];

    const exchange = new Sdk.PaymentProcessorV21.Exchange(config.chainId);
    const exchangeAddress = exchange.contract.address.toLowerCase();

    switch (subKind) {
      // These should be moved to a separate file for handling registry events

      case "payment-processor-registry-updated-token-level-pricing-boundaries":
      case "payment-processor-registry-updated-collection-payment-settings": {
        const parsedLog = eventData.abi.parseLog(log);
        const tokenAddress = parsedLog.args["tokenAddress"].toLowerCase();

        // Refresh
        const ppConfig = await paymentProcessorRegistryUtils.getConfigByContract(
          exchangeAddress,
          tokenAddress,
          true
        );
        if (ppConfig) {
          // Update backfilled royalties
          await paymentProcessorRegistryUtils.saveBackfilledRoyalties(tokenAddress, [
            {
              recipient: ppConfig.royaltyBackfillReceiver,
              bps: ppConfig.royaltyBackfillNumerator,
            },
          ]);
        }

        break;
      }

      case "payment-processor-registry-trusted-channel-removed-for-collection":
      case "payment-processor-registry-trusted-channel-added-for-collection": {
        const parsedLog = eventData.abi.parseLog(log);
        const tokenAddress = parsedLog.args["tokenAddress"].toLowerCase();

        // Refresh
        await paymentProcessorRegistryUtils.getTrustedChannels(tokenAddress, true);

        break;
      }

      case "payment-processor-registry-payment-method-added-to-whitelist":
      case "payment-processor-registry-payment-method-removed-from-whitelist": {
        const parsedLog = eventData.abi.parseLog(log);
        const paymentMethodWhitelistId = parsedLog.args["paymentMethodWhitelistId"];

        // Refresh
        await paymentProcessorRegistryUtils.getPaymentMethods(paymentMethodWhitelistId, true);

        break;
      }
    }
  }
};
