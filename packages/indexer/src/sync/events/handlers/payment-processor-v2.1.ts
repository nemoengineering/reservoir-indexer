import { Result, defaultAbiCoder } from "@ethersproject/abi";
import { Log } from "@ethersproject/abstract-provider";
import { AddressZero, HashZero } from "@ethersproject/constants";
import { searchForCalls } from "@georgeroman/evm-tx-simulator";
import * as Sdk from "@reservoir0x/sdk";

import { redb } from "@/common/db";
import { logger } from "@/common/logger";
import { bn } from "@/common/utils";
import { config } from "@/config/index";
import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import { getERC20Transfer } from "@/events-sync/handlers/utils/erc20";
import { Event as FillEvent } from "@/events-sync/storage/fill-events";
import * as utils from "@/events-sync/utils";
import * as commonHelpers from "@/orderbook/orders/common/helpers";
import { getUSDAndNativePrices } from "@/utils/prices";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  // Keep track of all events within the currently processing transaction
  let currentTx: string | undefined;
  let currentTxLogs: Log[] = [];

  // Keep track of all fill events
  let fillEvents: FillEvent[] = [];

  // Handle the events
  for (const { subKind, baseEventParams, log } of events) {
    if (currentTx !== baseEventParams.txHash) {
      currentTx = baseEventParams.txHash;
      currentTxLogs = [];
    }
    currentTxLogs.push(log);

    const eventData = getEventData([subKind])[0];

    const orderKind = "payment-processor-v2.1";
    const exchange = new Sdk.PaymentProcessorV21.Exchange(config.chainId);
    const exchangeAddress = exchange.contract.address.toLowerCase();

    switch (subKind) {
      case "payment-processor-v2.1-nonce-invalidated": {
        const parsedLog = eventData.abi.parseLog(log);
        const maker = parsedLog.args["account"].toLowerCase();
        const nonce = parsedLog.args["nonce"].toString();

        onChainData.nonceCancelEvents.push({
          orderKind,
          maker,
          nonce,
          baseEventParams,
        });

        break;
      }

      case "payment-processor-v2.1-nonce-restored": {
        const parsedLog = eventData.abi.parseLog(log);
        const maker = parsedLog.args["account"].toLowerCase();
        const nonce = parsedLog.args["nonce"].toString();

        let matchingFillEventIndex = -1;
        for (let i = 0; i < fillEvents.length; i++) {
          const fe = fillEvents[i];
          if (fe.maker === maker && fe.orderId) {
            const feNonce = await redb.oneOrNone(
              "SELECT orders.nonce FROM orders WHERE orders.id = $/id/",
              { id: fe.orderId }
            );
            if (feNonce === nonce) {
              matchingFillEventIndex = i;
            }
          }
        }
        if (matchingFillEventIndex !== -1) {
          fillEvents = fillEvents.splice(matchingFillEventIndex, 1);
        }

        break;
      }

      case "payment-processor-v2.1-order-digest-items-restored": {
        const parsedLog = eventData.abi.parseLog(log);
        const orderDigest = parsedLog.args["orderDigest"].toLowerCase();

        let matchingFillEventIndex = -1;
        for (let i = 0; i < fillEvents.length; i++) {
          const fe = fillEvents[i];
          if (fe.orderId === orderDigest) {
            matchingFillEventIndex = i;
          }
        }
        if (matchingFillEventIndex !== -1) {
          fillEvents = fillEvents.splice(matchingFillEventIndex, 1);
        }

        break;
      }

      case "payment-processor-v2.1-order-digest-invalidated": {
        const parsedLog = eventData.abi.parseLog(log);
        const orderId = parsedLog.args["orderDigest"].toLowerCase();
        const wasCancellation = parsedLog.args["wasCancellation"];

        if (wasCancellation) {
          onChainData.cancelEvents.push({
            orderKind,
            orderId,
            baseEventParams,
          });
        }

        break;
      }

      case "payment-processor-v2.1-master-nonce-invalidated": {
        const parsedLog = eventData.abi.parseLog(log);
        const maker = parsedLog.args["account"].toLowerCase();
        const newNonce = parsedLog.args["nonce"].toString();

        // Cancel all maker's orders
        onChainData.bulkCancelEvents.push({
          orderKind,
          maker,
          minNonce: bn(newNonce).add(1).toString(),
          acrossAll: true,
          baseEventParams,
        });

        break;
      }

      case "payment-processor-v2.1-accept-offer-erc1155":
      case "payment-processor-v2.1-accept-offer-erc721":
      case "payment-processor-v2.1-buy-listing-erc1155":
      case "payment-processor-v2.1-buy-listing-erc721": {
        // Again the events are extremely poorly designed (order hash is not emitted)
        // so we have to rely on complex tricks (using call tracing) to associate the
        // sales to order ids

        const parsedLog = eventData.abi.parseLog(log);

        const txHash = baseEventParams.txHash;

        const tokenIdOfEvent = parsedLog.args["tokenId"].toString();
        const tokenAddressOfEvent = parsedLog.args["tokenAddress"].toLowerCase();
        const tokenAmountOfEvent = (parsedLog.args["amount"] ?? 1).toString();
        const paymentCoinOfEvent = parsedLog.args["paymentCoin"].toLowerCase();

        const methods = [
          {
            selector: "0xc32dacae",
            name: "buyListing",
            abi: [
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              ) saleDetails`,
              "(uint256 v, bytes32 r, bytes32 s) sellerSignature",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature",
              "(address recipient, uint256 amount) feeOnTop",
            ],
          },
          {
            selector: "0x08fdd68e",
            name: "acceptOffer",
            abi: [
              "bool isCollectionLevelOffer",
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              ) saleDetails`,
              "(uint256 v, bytes32 r, bytes32 s) buyerSignature",
              "(bytes32 rootHash, bytes32[] proof) tokenSetProof",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature",
              "(address recipient, uint256 amount) feeOnTop",
            ],
          },
          {
            selector: "0x88d64fe8",
            name: "bulkAcceptOffers",
            abi: [
              `(
                bool isCollectionLevelOffer,
                (
                  uint256 protocol,
                  address maker,
                  address beneficiary,
                  address marketplace,
                  address fallbackRoyaltyRecipient,
                  address paymentMethod,
                  address tokenAddress,
                  uint256 tokenId,
                  uint256 amount,
                  uint256 itemPrice,
                  uint256 nonce,
                  uint256 expiration,
                  uint256 marketplaceFeeNumerator,
                  uint256 maxRoyaltyFeeNumerator,
                  uint256 requestedFillAmount,
                  uint256 minimumFillAmount
                ) saleDetails,
                (uint256 v, bytes32 r, bytes32 s) buyerSignature,
                (address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature,
              )[] params`,
              "(address recipient, uint256 amount)[] feesOnTopArray",
              "(bytes32 rootHash, bytes32[] proof)[] tokenSetProofsArray",
            ],
          },
          {
            selector: "0x863eb2d2",
            name: "bulkBuyListings",
            abi: [
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              )[] saleDetailsArray`,
              "(uint256 v, bytes32 r, bytes32 s)[] sellerSignatures",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s)[] cosignatures",
              "(address recipient, uint256 amount)[] feesOnTop",
            ],
          },
          {
            selector: "0x96c3ae25",
            name: "sweepCollection",
            abi: [
              "(address recipient, uint256 amount) feeOnTop",
              "(uint256 protocol, address tokenAddress, address paymentMethod, address beneficiary) sweepOrder",
              `(
                address maker,
                address marketplace,
                address fallbackRoyaltyRecipient,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator
              )[] items`,
              "(uint256 v, bytes32 r, bytes32 s)[] signedSellOrders",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s)[] cosignatures",
            ],
          },

          {
            selector: "0x74009baa",
            name: "buyListingAdvanced",
            abi: [
              `(
                (
                  uint256 protocol,
                  address maker,
                  address beneficiary,
                  address marketplace,
                  address fallbackRoyaltyRecipient,
                  address paymentMethod,
                  address tokenAddress,
                  uint256 tokenId,
                  uint256 amount,
                  uint256 itemPrice,
                  uint256 nonce,
                  uint256 expiration,
                  uint256 marketplaceFeeNumerator,
                  uint256 maxRoyaltyFeeNumerator,
                  uint256 requestedFillAmount,
                  uint256 minimumFillAmount
                ) saleDetails,
                ( 
                  uint256 v, 
                  bytes32 r,
                  bytes32 s
                ) signature,
                (
                  address signer,
                  address taker,
                  uint256 expiration,
                  uint256 v,
                  bytes32 r, 
                  bytes32 s
                ) cosignature,
                (
                  address permitProcessor,
                  uint256 permitNonce
                ) permitContext
              ) advancedListing`,
              `(uint256 orderIndex, bytes32[] proof) bulkOrderProof`,
              `(address recipient, uint256 amount) feeOnTop`,
            ],
          },

          {
            selector: "0x3f4b956a",
            name: "acceptOfferAdvanced",
            abi: [
              `(
                bool isCollectionLevelOrder,
                (
                  (
                    uint256 protocol,
                    address maker,
                    address beneficiary,
                    address marketplace,
                    address fallbackRoyaltyRecipient,
                    address paymentMethod,
                    address tokenAddress,
                    uint256 tokenId,
                    uint256 amount,
                    uint256 itemPrice,
                    uint256 nonce,
                    uint256 expiration,
                    uint256 marketplaceFeeNumerator,
                    uint256 maxRoyaltyFeeNumerator,
                    uint256 requestedFillAmount,
                    uint256 minimumFillAmount
                  ) saleDetails,
                  ( 
                    uint256 v, 
                    bytes32 r,
                    bytes32 s
                  ) signature,
                  (
                    address signer,
                    address taker,
                    uint256 expiration,
                    uint256 v,
                    bytes32 r, 
                    bytes32 s
                  ) cosignature,
                  (
                    address permitProcessor,
                    uint256 permitNonce
                  ) permitContext
                ) advancedOrder,
                ( 
                  uint256 v, 
                  bytes32 r,
                  bytes32 s
                ) sellerPermitSignature
              ) advancedBid`,
              `(uint256 orderIndex, bytes32[] proof ) bulkOrderProof`,
              `(address recipient, uint256 amount) feeOnTop`,
              `(bytes32 rootHash, bytes32[] proof) tokenSetProof`,
            ],
          },

          {
            selector: "0x173ea858",
            name: "bulkAcceptOffersAdvanced",
            abi: [
              `(
                bool isCollectionLevelOrder,
                (
                  (
                    uint256 protocol,
                    address maker,
                    address beneficiary,
                    address marketplace,
                    address fallbackRoyaltyRecipient,
                    address paymentMethod,
                    address tokenAddress,
                    uint256 tokenId,
                    uint256 amount,
                    uint256 itemPrice,
                    uint256 nonce,
                    uint256 expiration,
                    uint256 marketplaceFeeNumerator,
                    uint256 maxRoyaltyFeeNumerator,
                    uint256 requestedFillAmount,
                    uint256 minimumFillAmount
                  ) saleDetails,
                  ( 
                    uint256 v, 
                    bytes32 r,
                    bytes32 s
                  ) signature,
                  (
                    address signer,
                    address taker,
                    uint256 expiration,
                    uint256 v,
                    bytes32 r, 
                    bytes32 s
                  ) cosignature,
                  (
                    address permitProcessor,
                    uint256 permitNonce
                  ) permitContext
                ) advancedOrder,
                ( 
                  uint256 v, 
                  bytes32 r,
                  bytes32 s
                ) sellerPermitSignature
              )[] advancedBidsArray`,
              `(uint256 orderIndex, bytes32[] proof)[] bulkOrderProofs`,
              `(address recipient, uint256 amount)[] feesOnTop`,
              `(bytes32 rootHash, bytes32[] proof)[] tokenSetProofs`,
            ],
          },
          {
            selector: "0xee728d6a",
            name: "bulkBuyListingsAdvanced",
            abi: [
              `(
                (
                  uint256 protocol,
                  address maker,
                  address beneficiary,
                  address marketplace,
                  address fallbackRoyaltyRecipient,
                  address paymentMethod,
                  address tokenAddress,
                  uint256 tokenId,
                  uint256 amount,
                  uint256 itemPrice,
                  uint256 nonce,
                  uint256 expiration,
                  uint256 marketplaceFeeNumerator,
                  uint256 maxRoyaltyFeeNumerator,
                  uint256 requestedFillAmount,
                  uint256 minimumFillAmount
                ) saleDetails,
                ( 
                  uint256 v, 
                  bytes32 r,
                  bytes32 s
                ) signature,
                (
                  address signer,
                  address taker,
                  uint256 expiration,
                  uint256 v,
                  bytes32 r, 
                  bytes32 s
                ) cosignature,
                (
                  address permitProcessor,
                  uint256 permitNonce
                ) permitContext
              )[] advancedListingsArray`,
              `(uint256 orderIndex, bytes32[] proof)[] bulkOrderProofs`,
              `(address recipient, uint256 amount)[] feesOnTop`,
            ],
          },
          {
            selector: "0x548c9099",
            name: "sweepCollectionAdvanced",
            abi: [
              `
                (
                  (
                    address recipient,
                    uint256 amount
                  ) feeOnTop,
                  (
                    uint256 protocol,
                    address tokenAddress,
                    address paymentMethod, 
                    address beneficiary
                  ) sweepOrder,
                  (
                    (
                      address maker,
                      address marketplace,
                      address fallbackRoyaltyRecipient,
                      uint256 tokenId,
                      uint256 amount,
                      uint256 itemPrice,
                      uint256 nonce,
                      uint256 expiration,
                      uint256 marketplaceFeeNumerator,
                      uint256 maxRoyaltyFeeNumerator
                    ) sweepItem,
                    ( 
                      uint256 v, 
                      bytes32 r,
                      bytes32 s
                    ) signature,
                    (
                      address signer,
                      address taker,
                      uint256 expiration,
                      uint256 v,
                      bytes32 r, 
                      bytes32 s
                    ) cosignature,
                    (
                      address permitProcessor,
                      uint256 permitNonce
                    ) permitContext,
                    (
                      uint256 orderIndex,
                      bytes32[] proof
                    ) bulkOrderProof,
                  ) items
                ) advancedSweep
              `,
            ],
          },
        ];

        const relevantCalls: string[] = [];

        const txTrace = await utils.fetchTransactionTrace(txHash);
        if (txTrace) {
          try {
            const calls = searchForCalls(txTrace.calls, {
              to: exchangeAddress,
              type: "call",
              sigHashes: methods.map((c) => c.selector),
            });
            for (const call of calls) {
              relevantCalls.push(call.input ?? "0x");
            }
          } catch (error) {
            logger.info(
              "pp-v2",
              JSON.stringify({
                msg: "Could not get transaction trace",
                log,
                parsingError: true,
                error,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stack: (error as any).stack,
              })
            );
            throw new Error("Could not get transaction trace");
          }
        } else {
          logger.info(
            "pp-v2",
            JSON.stringify({
              msg: "Could not get transaction trace",
              log,
              isMissingTrace: true,
            })
          );

          throw new Error("Could not get transaction trace");
        }

        const saleDetailsArray = [];
        const saleSignatures = [];
        const tokenSetProofs = [];
        const cosignatures = [];
        const bulkOrderProofs = [];
        const isCollectionLevelOfferArray = [];

        const allFillEvents = events.filter(
          (c) =>
            c.baseEventParams.txHash === txHash &&
            [
              "payment-processor-v2.1-accept-offer-erc1155",
              "payment-processor-v2.1-accept-offer-erc721",
              "payment-processor-v2.1-buy-listing-erc1155",
              "payment-processor-v2.1-buy-listing-erc721",
            ].includes(c.subKind)
        );

        const currentFillIndex = allFillEvents.findIndex(
          (c) =>
            c.baseEventParams.logIndex === baseEventParams.logIndex &&
            c.baseEventParams.txHash === txHash
        );

        for (const relevantCalldata of relevantCalls) {
          const matchedMethod = methods.find((c) => relevantCalldata.includes(c.selector));
          if (!matchedMethod) {
            logger.info(
              "pp-v2",
              JSON.stringify({ msg: "Missing matched method", log, relevantCalldata })
            );
            continue;
          }

          const args = exchange.contract.interface.decodeFunctionData(
            matchedMethod.name,
            relevantCalldata
          );

          const inputData = defaultAbiCoder.decode(matchedMethod.abi, args.data);
          let saleDetailsArrayTemp = [inputData.saleDetails];
          let saleSignaturesTemp = [inputData.buyerSignature || inputData.sellerSignature];
          let tokenSetProofsTemp = [inputData.tokenSetProof];
          let cosignaturesTemp = [inputData.cosignature];
          let bulkOrderProofsTemp = [undefined];
          let isCollectionLevelOfferArrayTemp = [inputData.isCollectionLevelOffer];

          if (matchedMethod.name === "sweepCollection") {
            const sweepOrder = inputData.sweepOrder;
            saleSignaturesTemp = inputData.signedSellOrders;
            saleDetailsArrayTemp = inputData.items.map((c: Result) => {
              return {
                protocol: sweepOrder.protocol,
                tokenAddress: sweepOrder.tokenAddress,
                paymentMethod: sweepOrder.paymentMethod,
                beneficiary: sweepOrder.beneficiary,
                maker: c.maker,
                itemPrice: c.itemPrice,
                tokenId: c.tokenId,
                amount: c.amount,
                marketplace: c.marketplace,
                marketplaceFeeNumerator: c.marketplaceFeeNumerator,
                maxRoyaltyFeeNumerator: c.maxRoyaltyFeeNumerator,
                expiration: c.expiration,
                nonce: c.nonce,
              };
            });
          } else if (matchedMethod.name === "bulkBuyListings") {
            saleDetailsArrayTemp = inputData.saleDetailsArray;
            saleSignaturesTemp = inputData.sellerSignatures;
            cosignaturesTemp = inputData.cosignatures;
          } else if (matchedMethod.name === "bulkAcceptOffers") {
            isCollectionLevelOfferArrayTemp = inputData.params.map(
              (p: Result) => p.isCollectionLevelOffer
            );
            saleDetailsArrayTemp = inputData.params.map((p: Result) => p.saleDetails);
            saleSignaturesTemp = inputData.params.map((p: Result) => p.buyerSignature);
            cosignaturesTemp = inputData.params.map((p: Result) => p.cosignature);
            tokenSetProofsTemp = inputData.tokenSetProofsArray;
          } else if (["buyListingAdvanced"].includes(matchedMethod.name)) {
            saleDetailsArrayTemp = [inputData.advancedListing.saleDetails];
            saleSignaturesTemp = [inputData.advancedListing.signature];
            cosignaturesTemp = [inputData.advancedListing.cosignature];
            bulkOrderProofsTemp = [inputData.bulkOrderProof];
          } else if (["acceptOfferAdvanced"].includes(matchedMethod.name)) {
            isCollectionLevelOfferArrayTemp = [inputData.advancedBid.isCollectionOffer];
            saleDetailsArrayTemp = [inputData.advancedBid.advancedOrder.saleDetails];
            saleSignaturesTemp = [inputData.advancedBid.advancedOrder.signature];
            cosignaturesTemp = [inputData.advancedBid.advancedOrder.cosignature];
            bulkOrderProofsTemp = [inputData.bulkOrderProof];
            tokenSetProofsTemp = [inputData.tokenSetProof];
          } else if (["bulkBuyListingsAdvanced"].includes(matchedMethod.name)) {
            saleDetailsArrayTemp = inputData.advancedListingsArray.map(
              (c: Result) => c.saleDetails
            );
            saleSignaturesTemp = inputData.advancedListingsArray.map((c: Result) => c.signature);
            cosignaturesTemp = inputData.advancedListingsArray.map((c: Result) => c.cosignature);
            bulkOrderProofsTemp = inputData.bulkOrderProofs;
          } else if (["bulkAcceptOffersAdvanced"].includes(matchedMethod.name)) {
            saleDetailsArrayTemp = inputData.advancedBidsArray.map(
              (c: Result) => c.advancedOrder.saleDetails
            );
            saleSignaturesTemp = inputData.advancedBidsArray.map(
              (c: Result) => c.advancedOrder.signature
            );
            cosignaturesTemp = inputData.advancedBidsArray.map(
              (c: Result) => c.advancedOrder.cosignature
            );

            isCollectionLevelOfferArrayTemp = inputData.advancedBidsArray.map(
              (c: Result) => c.isCollectionOffer
            );
            bulkOrderProofsTemp = inputData.bulkOrderProofs;
            tokenSetProofsTemp = inputData.tokenSetProofs;
          } else if (["sweepCollectionAdvanced"].includes(matchedMethod.name)) {
            const sweepOrder = inputData.sweepOrder;
            saleSignaturesTemp = inputData.items.map((c: Result) => c.signature);
            cosignaturesTemp = inputData.items.map((c: Result) => c.cosignature);
            bulkOrderProofsTemp = inputData.items.map((c: Result) => c.bulkOrderProof);

            saleDetailsArrayTemp = inputData.items.map((c: Result) => {
              return {
                protocol: sweepOrder.protocol,
                tokenAddress: sweepOrder.tokenAddress,
                paymentMethod: sweepOrder.paymentMethod,
                beneficiary: sweepOrder.beneficiary,
                maker: c.maker,
                itemPrice: c.itemPrice,
                tokenId: c.tokenId,
                amount: c.amount,
                marketplace: c.marketplace,
                marketplaceFeeNumerator: c.marketplaceFeeNumerator,
                maxRoyaltyFeeNumerator: c.maxRoyaltyFeeNumerator,
                expiration: c.expiration,
                nonce: c.nonce,
              };
            });
          }

          saleDetailsArray.push(...saleDetailsArrayTemp);
          saleSignatures.push(...saleSignaturesTemp);
          tokenSetProofs.push(...tokenSetProofsTemp);
          cosignatures.push(...cosignaturesTemp);
          bulkOrderProofs.push(...bulkOrderProofsTemp);
          isCollectionLevelOfferArray.push(...isCollectionLevelOfferArrayTemp);
        }

        // TODO: cover advanced methods
        const [saleDetail, saleSignature, cosignature, isCollectionLevelOffer, bulkOrderProof] = [
          saleDetailsArray[currentFillIndex],
          saleSignatures[currentFillIndex],
          cosignatures[currentFillIndex],
          isCollectionLevelOfferArray[currentFillIndex],
          bulkOrderProofs[currentFillIndex],
        ];
        if (!saleDetail) {
          continue;
        }

        const tokenAddress = saleDetail["tokenAddress"].toLowerCase();
        const tokenId = saleDetail["tokenId"].toString();
        const currency = saleDetail["paymentMethod"].toLowerCase();
        const currencyPrice = saleDetail["itemPrice"].div(saleDetail["amount"]).toString();
        const paymentMethod = saleDetail["paymentMethod"].toLowerCase();

        if (
          !(
            tokenAddress === tokenAddressOfEvent &&
            tokenId === tokenIdOfEvent &&
            paymentMethod === paymentCoinOfEvent
          )
        ) {
          // Skip
          continue;
        }

        const isBuyOrder = subKind.includes("accept-offer");
        const maker = isBuyOrder
          ? parsedLog.args["buyer"].toLowerCase()
          : parsedLog.args["seller"].toLowerCase();

        let taker = isBuyOrder
          ? parsedLog.args["seller"].toLowerCase()
          : parsedLog.args["buyer"].toLowerCase();

        const orderSide = !isBuyOrder ? "sell" : "buy";
        const makerMinNonce = await commonHelpers.getMinNonce(orderKind, maker);

        const orderSignature = saleSignature;
        const signature = {
          r: orderSignature.r,
          s: orderSignature.s,
          v: orderSignature.v,
        };

        let order: Sdk.PaymentProcessorV21.Order;

        const cosigner = cosignature ? cosignature.signer.toLowerCase() : AddressZero;

        if (isCollectionLevelOffer) {
          const tokenSetProof = tokenSetProofs[currentFillIndex];
          if (tokenSetProof.rootHash === HashZero) {
            const builder = new Sdk.PaymentProcessorV21.Builders.ContractWide(config.chainId);
            order = builder.build({
              protocol: saleDetail["protocol"],
              marketplace: saleDetail["marketplace"],
              beneficiary: saleDetail["beneficiary"],
              marketplaceFeeNumerator: saleDetail["marketplaceFeeNumerator"],
              maxRoyaltyFeeNumerator: saleDetail["maxRoyaltyFeeNumerator"],
              maker: saleDetail["maker"],
              tokenAddress: saleDetail["tokenAddress"],
              amount: saleDetail["amount"],
              itemPrice: saleDetail["itemPrice"],
              expiration: saleDetail["expiration"],
              nonce: saleDetail["nonce"],
              paymentMethod: saleDetail["paymentMethod"],
              masterNonce: makerMinNonce,
              cosigner,
              ...signature,
            });
          } else {
            const builder = new Sdk.PaymentProcessorV21.Builders.TokenList(config.chainId);
            order = builder.build({
              protocol: saleDetail["protocol"],
              marketplace: saleDetail["marketplace"],
              beneficiary: saleDetail["beneficiary"],
              marketplaceFeeNumerator: saleDetail["marketplaceFeeNumerator"],
              maxRoyaltyFeeNumerator: saleDetail["maxRoyaltyFeeNumerator"],
              maker: saleDetail["maker"],
              tokenAddress: saleDetail["tokenAddress"],
              amount: saleDetail["amount"],
              itemPrice: saleDetail["itemPrice"],
              expiration: saleDetail["expiration"],
              nonce: saleDetail["nonce"],
              paymentMethod: saleDetail["paymentMethod"],
              masterNonce: makerMinNonce,
              tokenSetMerkleRoot: tokenSetProof.rootHash,
              tokenIds: [],
              cosigner,
              ...signature,
            });
          }
        } else {
          const builder = new Sdk.PaymentProcessorV21.Builders.SingleToken(config.chainId);
          order = builder.build({
            protocol: saleDetail["protocol"],
            marketplace: saleDetail["marketplace"],
            marketplaceFeeNumerator: saleDetail["marketplaceFeeNumerator"],
            maxRoyaltyFeeNumerator: saleDetail["maxRoyaltyFeeNumerator"],
            tokenAddress: saleDetail["tokenAddress"],
            amount: saleDetail["amount"],
            tokenId: saleDetail["tokenId"],
            expiration: saleDetail["expiration"],
            itemPrice: saleDetail["itemPrice"],
            maker: saleDetail["maker"],
            ...(isBuyOrder
              ? {
                  beneficiary: saleDetail["beneficiary"],
                }
              : {}),
            nonce: saleDetail["nonce"],
            paymentMethod: saleDetail["paymentMethod"],
            masterNonce: makerMinNonce,
            cosigner,
            ...signature,
          });
        }

        if (bulkOrderProof) {
          order.params.bulkOrderProof = bulkOrderProof;
        }

        let isValidated = false;
        const MAX_ITERATIONS = 100;
        const minNonceToCheck = Math.max(Number(order.params.masterNonce) - MAX_ITERATIONS, 0);
        for (let nonce = Number(order.params.masterNonce); nonce >= minNonceToCheck; nonce--) {
          order.params.masterNonce = nonce.toString();
          try {
            order.checkSignature();
            isValidated = true;
            break;
          } catch {
            // Skip errors
          }
        }

        const priceData = await getUSDAndNativePrices(
          currency,
          currencyPrice,
          baseEventParams.timestamp
        );
        if (!priceData.nativePrice) {
          // We must always have the native price
          break;
        }

        let orderId = isValidated ? order.hash() : undefined;

        // If we couldn't parse the order id from the calldata try to get it from our db
        if (!orderId) {
          orderId = await commonHelpers.getOrderIdFromNonce(
            orderKind,
            order.params.sellerOrBuyer,
            order.params.nonce
          );
        }

        // Handle: attribution
        const attributionData = await utils.extractAttributionData(
          baseEventParams.txHash,
          orderKind,
          { orderId }
        );
        if (attributionData.taker) {
          taker = attributionData.taker;
        }

        fillEvents.push({
          orderId,
          orderKind,
          orderSide,
          maker,
          taker,
          price: priceData.nativePrice,
          currency,
          currencyPrice,
          usdPrice: priceData.usdPrice,
          contract: tokenAddress,
          tokenId,
          amount: tokenAmountOfEvent,
          orderSourceId: attributionData.orderSource?.id,
          aggregatorSourceId: attributionData.aggregatorSource?.id,
          fillSourceId: attributionData.fillSource?.id,
          baseEventParams,
        });

        onChainData.fillInfos.push({
          context: `${orderId}-${baseEventParams.txHash}`,
          orderId,
          orderSide,
          contract: tokenAddress,
          tokenId,
          amount: tokenAmountOfEvent,
          price: priceData.nativePrice,
          timestamp: baseEventParams.timestamp,
          maker,
          taker,
        });

        onChainData.orderInfos.push({
          context: `filled-${orderId}-${baseEventParams.txHash}`,
          id: orderId,
          trigger: {
            kind: "sale",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
        });

        // If an ERC20 transfer occured in the same transaction as a sale
        // then we need resync the maker's ERC20 approval to the exchange
        const erc20 = getERC20Transfer(currentTxLogs);
        if (erc20) {
          onChainData.makerInfos.push({
            context: `${baseEventParams.txHash}-buy-approval`,
            maker,
            trigger: {
              kind: "approval-change",
              txHash: baseEventParams.txHash,
              txTimestamp: baseEventParams.timestamp,
            },
            data: {
              kind: "buy-approval",
              contract: erc20,
              orderKind,
            },
          });
        }

        break;
      }
    }
  }

  // Apply all fill events
  onChainData.fillEventsPartial = fillEvents;
};
