import { AddressZero } from "@ethersproject/constants";

import { getEventData } from "@/events-sync/data";
import { EnhancedEvent, OnChainData } from "@/events-sync/handlers/utils";
import _ from "lodash";

export const handleEvents = async (events: EnhancedEvent[], onChainData: OnChainData) => {
  const erc20Transfers = [];

  // Handle the events
  for (const { subKind, baseEventParams, log } of events) {
    const eventData = getEventData([subKind])[0];
    switch (subKind) {
      case "erc20-transfer": {
        const parsedLog = eventData.abi.parseLog(log);
        const from = parsedLog.args["from"].toLowerCase();
        const to = parsedLog.args["to"].toLowerCase();
        const amount = parsedLog.args["amount"].toString();

        erc20Transfers.push({ baseEventParams, log, parsedLog, subKind });

        onChainData.ftTransferEvents.push({
          from,
          to,
          amount,
          baseEventParams,
        });

        // Make sure to only handle the same data once per transaction
        const contextPrefix = `${baseEventParams.txHash}-${baseEventParams.address}`;

        onChainData.makerInfos.push({
          context: `${contextPrefix}-${from}-buy-balance`,
          maker: from,
          trigger: {
            kind: "balance-change",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
          data: {
            kind: "buy-balance",
            contract: baseEventParams.address,
          },
        });

        onChainData.makerInfos.push({
          context: `${contextPrefix}-${to}-buy-balance`,
          maker: to,
          trigger: {
            kind: "balance-change",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
          data: {
            kind: "buy-balance",
            contract: baseEventParams.address,
          },
        });

        break;
      }

      case "erc20-approval": {
        const parsedLog = eventData.abi.parseLog(log);
        const owner = parsedLog.args["owner"].toLowerCase();
        const spender = parsedLog.args["spender"].toLowerCase();

        // Make sure to only handle the same data once per transaction
        const contextPrefix = `${baseEventParams.txHash}-${baseEventParams.address}`;

        onChainData.makerInfos.push({
          context: `${contextPrefix}-${owner}-${spender}-buy-approval`,
          maker: owner,
          trigger: {
            kind: "approval-change",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
          data: {
            kind: "buy-approval",
            contract: baseEventParams.address,
            operator: spender,
          },
        });

        // Recheck every permit that could have been affected
        onChainData.permitInfos.push({
          kind: "eip2612",
          owner,
          token: baseEventParams.address,
        });

        break;
      }

      case "weth-deposit": {
        const parsedLog = eventData.abi.parseLog(log);
        const to = parsedLog.args["to"].toLowerCase();
        const amount = parsedLog.args["amount"].toString();

        erc20Transfers.push({ baseEventParams, log, parsedLog, subKind });

        onChainData.ftTransferEvents.push({
          from: AddressZero,
          to,
          amount,
          baseEventParams,
        });

        // Make sure to only handle the same data once per transaction
        const contextPrefix = `${baseEventParams.txHash}-${baseEventParams.address}`;

        onChainData.makerInfos.push({
          context: `${contextPrefix}-${to}-buy-balance`,
          maker: to,
          trigger: {
            kind: "balance-change",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
          data: {
            kind: "buy-balance",
            contract: baseEventParams.address,
          },
        });

        break;
      }

      case "weth-withdrawal": {
        const parsedLog = eventData.abi.parseLog(log);
        const from = parsedLog.args["from"].toLowerCase();
        const amount = parsedLog.args["amount"].toString();

        erc20Transfers.push({ baseEventParams, log, parsedLog, subKind });

        onChainData.ftTransferEvents.push({
          from,
          to: AddressZero,
          amount,
          baseEventParams,
        });

        // Make sure to only handle the same data once per transaction
        const contextPrefix = `${baseEventParams.txHash}-${baseEventParams.address}`;

        onChainData.makerInfos.push({
          context: `${contextPrefix}-${from}-buy-balance`,
          maker: from,
          trigger: {
            kind: "balance-change",
            txHash: baseEventParams.txHash,
            txTimestamp: baseEventParams.timestamp,
          },
          data: {
            kind: "buy-balance",
            contract: baseEventParams.address,
          },
        });

        break;
      }
    }
  }

  if (erc20Transfers.length) {
    const zkSyncAddress = "0x000000000000000000000000000000000000800a";

    // Find first transfer and skip any zksync specific transfers
    const firstTransfer = _.find(
      erc20Transfers,
      (t) => t.log.address?.toLowerCase() !== zkSyncAddress
    );

    const secondTransfer = _.find(
      erc20Transfers,
      (t) => t.log.address?.toLowerCase() !== zkSyncAddress,
      _.findIndex(erc20Transfers, (t) => t.log.address?.toLowerCase() !== zkSyncAddress) + 1
    );

    // Find first weth deposit
    const firstWethDeposit = _.find(erc20Transfers, (t) => t.subKind === "weth-deposit");

    // Find solver deposit
    const solverDeposit = _.find(
      erc20Transfers,
      (t) => t.parsedLog.args["to"]?.toLowerCase() === "0xf70da97812cb96acdf810712aa562db8dfa3dbef"
    );

    // Find last transfer and skip any zksync specific transfers
    const lastTransfer = _.findLast(
      erc20Transfers,
      (t) => t.log.address?.toLowerCase() !== zkSyncAddress
    );

    // Token to Token Swap detection
    // * The tx has no value OR there's a relay solver deposit equal the tx value
    // * The tx executor is the sender and recipient of the first and last transfers
    // * The addresses of first and last transfers are different
    if (
      firstTransfer &&
      lastTransfer &&
      (firstTransfer.baseEventParams.value.eq(0) ||
        (solverDeposit &&
          firstTransfer.baseEventParams.value.eq(solverDeposit.parsedLog.args["amount"]))) &&
      firstTransfer.baseEventParams.from.toLowerCase() ===
        firstTransfer.parsedLog.args["from"]?.toLowerCase() &&
      firstTransfer.parsedLog.args["from"]?.toLowerCase() ===
        lastTransfer.parsedLog.args["to"]?.toLowerCase() &&
      firstTransfer.log.address?.toLowerCase() !== lastTransfer.log.address?.toLowerCase()
    ) {
      onChainData.swaps.push({
        wallet: firstTransfer.baseEventParams.from?.toLowerCase(),
        fromToken: firstTransfer.log.address?.toLowerCase(),
        fromAmount: firstTransfer.parsedLog.args["amount"].toString(),
        toToken: lastTransfer.log.address?.toLowerCase(),
        toAmount: lastTransfer.parsedLog.args["amount"].toString(),
        baseEventParams: firstTransfer.baseEventParams,
      });
    }

    // NATIVE to Token Swap detection
    // * The tx has value
    // * The first weth deposit equal the tx value OR there's a relay solver deposit + the weth deposit equal the tx value
    // * The tx executor is the recipient of the last transfer
    if (
      firstWethDeposit &&
      lastTransfer &&
      erc20Transfers.length &&
      firstWethDeposit.baseEventParams.value.gt(0) &&
      (firstWethDeposit.baseEventParams.value.eq(firstWethDeposit.log.data) ||
        (solverDeposit &&
          firstWethDeposit.baseEventParams.value.eq(
            solverDeposit.parsedLog.args["amount"].add(firstWethDeposit.log.data)
          ))) &&
      firstWethDeposit.baseEventParams.from?.toLowerCase() ===
        lastTransfer.parsedLog.args["to"]?.toLowerCase()
    ) {
      onChainData.swaps.push({
        wallet: firstWethDeposit.baseEventParams.from?.toLowerCase(),
        fromToken: AddressZero,
        fromAmount: firstWethDeposit.parsedLog.args["amount"].toString(),
        toToken: lastTransfer.log.address?.toLowerCase(),
        toAmount: lastTransfer.parsedLog.args["amount"].toString(),
        baseEventParams: firstWethDeposit.baseEventParams,
      });
    }

    // TOKEN to NATIVE Swap detection
    // * The tx has no value OR there's a relay solver deposit equal the tx value
    // * The first OR second transfer is from the tx executor
    // * The last transfer address is the wrapped native address
    // * the last transfer recipient is the zero address
    if (
      firstTransfer &&
      lastTransfer &&
      firstTransfer.baseEventParams.from?.toLowerCase() ===
        firstTransfer.parsedLog.args["from"]?.toLowerCase() &&
      (firstTransfer.baseEventParams.value.eq(0) ||
        (solverDeposit &&
          firstTransfer.baseEventParams.value.eq(solverDeposit.parsedLog.args["amount"]))) &&
      lastTransfer.subKind === "weth-withdrawal"
    ) {
      onChainData.swaps.push({
        wallet: firstTransfer.baseEventParams.from?.toLowerCase(),
        fromToken: firstTransfer.log.address?.toLowerCase(),
        fromAmount: firstTransfer.parsedLog.args["amount"].toString(),
        toToken: AddressZero,
        toAmount: lastTransfer.parsedLog.args["amount"].toString(),
        baseEventParams: firstTransfer.baseEventParams,
      });
    } else if (
      secondTransfer &&
      lastTransfer &&
      secondTransfer.baseEventParams.from.toLowerCase() ===
        secondTransfer.parsedLog.args["from"]?.toLowerCase() &&
      (secondTransfer.baseEventParams.value.eq(0) ||
        (solverDeposit &&
          secondTransfer.baseEventParams.value.eq(solverDeposit.parsedLog.args["amount"]))) &&
      lastTransfer.subKind === "weth-withdrawal"
    ) {
      onChainData.swaps.push({
        wallet: secondTransfer.baseEventParams.from?.toLowerCase(),
        fromToken: secondTransfer.log.address?.toLowerCase(),
        fromAmount: secondTransfer.parsedLog.args["amount"].toString(),
        toToken: AddressZero,
        toAmount: lastTransfer.parsedLog.args["amount"].toString(),
        baseEventParams: secondTransfer.baseEventParams,
      });
    }
  }
};
