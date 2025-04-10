import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  // Handle the events
  for (const { subKind, log, baseEventParams } of events) {
    const eventData = getEventData([subKind])[0];

    switch (subKind) {
      case "coinbase-contract-created": {
        const parsedLog = eventData.abi.parseLog(log);

        const address = baseEventParams.address.toLowerCase();
        const contractAddress = parsedLog.args["contractAddress"].toString();

        if (address === Sdk.Coinbase.Addresses.MintFactory[config.chainId]) {
          onChainData.mints.push({
            by: "collection",
            data: {
              standard: "coinbase",
              collection: contractAddress.toLowerCase(),
            },
          });
        } else if (address === Sdk.Coinbase.Addresses.GalleryMintFactory[config.chainId]) {
          onChainData.mints.push({
            by: "collection",
            data: {
              standard: "coinbase-gallery",
              collection: contractAddress.toLowerCase(),
            },
          });
        }

        break;
      }
    }
  }
};
