import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import * as onchain from "@/utils/royalties/onchain";
import * as royalties from "@/utils/royalties";
import { logger } from "@/common/logger";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  // Handle the events
  for (const { subKind, log, baseEventParams } of events) {
    const eventData = getEventData([subKind])[0];

    const collection = baseEventParams.address.toLowerCase();

    switch (subKind) {
      case "magiceden-new-contract-initialized": {
        const address = baseEventParams.address.toLowerCase();

        if (
          [
            "0x000000009e44eba131196847c685f20cd4b68ac4",
            "0x00000000bea935f8315156894aa4a45d3c7a0075",
            "0x4a08d3f6881c4843232efde05bacfb5eaab35d19",
            "0x0000000000000000000000000000000000010000",
          ].includes(address)
        ) {
          const parsedLog = eventData.abi.parseLog(log);
          const contractAddress = parsedLog.args["contractAddress"].toString();
          const standard = parsedLog.args["standard"].toString();

          logger.info(
            "magiceden-mint-detection",
            JSON.stringify({
              message: `magiceden handleEvents. subKind=${subKind}, standard=${standard}, collection=${contractAddress.toLowerCase()}`,
              collection: contractAddress.toLowerCase(),
              standard,
            })
          );

          if (standard === "0") {
            onChainData.mints.push({
              by: "collection",
              data: {
                standard: "magiceden",
                collection: contractAddress.toLowerCase(),
              },
            });
          } else if (standard === "1") {
            onChainData.mints.push({
              by: "collection",
              data: {
                standard: "magiceden",
                collection: contractAddress.toLowerCase(),
                tokenId: "0",
              },
            });
          }
        }

        break;
      }
      case "magiceden-max-supply-updated-erc721":
      case "magiceden-wallet-limit-updated-erc721":
      case "magiceden-public-stage-set": {
        const skipEvent = onChainData.mints.find(
          (m) =>
            m.by === "collection" &&
            m.data.standard === "magiceden" &&
            m.data.collection === collection
        );

        if (!skipEvent) {
          onChainData.mints.push({
            by: "collection",
            data: {
              standard: "magiceden",
              collection,
            },
          });
        }

        break;
      }
      case "magiceden-max-supply-updated-erc1155":
      case "magiceden-wallet-limit-updated-erc1155": {
        const parsedLog = eventData.abi.parseLog(log);
        const tokenId = parsedLog.args["_tokenId"].toString();

        const skipEvent = onChainData.mints.find(
          (m) =>
            m.by === "collection" &&
            m.data.standard === "magiceden" &&
            m.data.collection === collection &&
            m.data.tokenId === (tokenId ?? "0")
        );

        if (!skipEvent) {
          onChainData.mints.push({
            by: "collection",
            data: {
              standard: "magiceden",
              collection: baseEventParams.address.toLowerCase(),
              tokenId: tokenId ?? "0",
            },
          });
        }

        break;
      }
      case "magiceden-royalty-info-updated": {
        await onchain.refreshOnChainRoyalties(collection, "eip2981", false);
        await onchain.refreshOnChainRoyalties(collection, "onchain", false);

        await royalties.refreshDefaultRoyalties(collection, subKind);

        break;
      }
    }
  }
};
