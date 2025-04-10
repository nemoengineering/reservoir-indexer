import { BigNumberish } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/abstract-provider";

import { bn } from "../../../utils";
import { ExecutionInfo } from "../types";
import { isNative, isWNative } from "../utils";

import * as relay from "./relay";
import * as uniswap from "./uniswap";

export type SwapProvider = "uniswap" | "relay";

export type SwapInfo = {
  tokenIn: string;
  amountIn: BigNumberish;
  amountOut?: BigNumberish;
  module: Contract;
  execution: ExecutionInfo;
  kind: "wrap-or-unwrap" | "swap";
  provider: SwapProvider;
};

export type TransferDetail = {
  recipient: string;
  amount: BigNumberish;
  toETH: boolean;
};

export const generateSwapInfo = async (
  chainId: number,
  provider: Provider,
  swapProvider: SwapProvider,
  fromTokenAddress: string,
  toTokenAddress: string,
  toTokenAmount: BigNumberish,
  options: {
    direction: "sell" | "buy";
    module: Contract;
    transfers: TransferDetail[];
    refundTo: string;
    revertIfIncomplete: boolean;
  }
): Promise<SwapInfo> => {
  if (options.module.address === AddressZero) {
    throw new Error("Swapping tokens is not supported");
  }

  if (isNative(chainId, fromTokenAddress) && isWNative(chainId, toTokenAddress)) {
    // We need to wrap
    return {
      tokenIn: fromTokenAddress,
      amountIn: toTokenAmount,
      module: options.module,
      execution: {
        module: options.module.address,
        data: options.module.interface.encodeFunctionData("wrap", [options.transfers]),
        value: toTokenAmount,
      },
      kind: "wrap-or-unwrap",
      provider: swapProvider,
    };
  } else if (isWNative(chainId, fromTokenAddress) && isNative(chainId, toTokenAddress)) {
    // We need to unwrap
    return {
      tokenIn: fromTokenAddress,
      amountIn: toTokenAmount,
      module: options.module,
      execution: {
        module: options.module.address,
        data: options.module.interface.encodeFunctionData("unwrap", [options.transfers]),
        value: 0,
      },
      kind: "wrap-or-unwrap",
      provider: swapProvider,
    };
  } else {
    // We need to swap
    if (options.direction === "buy") {
      return (swapProvider === "uniswap" ? uniswap : relay).generateBuyExecutions(
        chainId,
        provider,
        fromTokenAddress,
        toTokenAddress,
        toTokenAmount,
        {
          module: options.module,
          transfers: options.transfers,
          refundTo: options.refundTo,
          revertIfIncomplete: options.revertIfIncomplete,
        }
      );
    } else {
      return (swapProvider === "uniswap" ? uniswap : relay).generateSellExecutions(
        chainId,
        provider,
        fromTokenAddress,
        toTokenAddress,
        toTokenAmount,
        {
          module: options.module,
          transfers: options.transfers,
          refundTo: options.refundTo,
          revertIfIncomplete: options.revertIfIncomplete,
        }
      );
    }
  }
};

// The flow of the router consists of first transferring all needed tokens to the swap module,
// then executing the swaps one by one in separate executions. Every execution will refund any
// tokens left in the contract, which means that it's not possible to have multiple swaps that
// all have the same input token since the first successful execution will result in refunding
// the remaining input tokens, tokens which are needed by other next executions. So here we're
// merging together the swaps that consist of the same input token. The merging is very simple
// and consists of bundling all the swap calls and all the transfer calls so that we only need
// a single execution for a given input token. This is only needed since in the router code we
// have each swap execution being generated individually as we iterate through the orders that
// require filling.
export const mergeSwapInfos = (
  chainId: number,
  infos: SwapInfo[],
  direction: "sell" | "buy"
): SwapInfo[] => {
  if (!infos.length) {
    return [];
  }

  // Assume all swap infos have the same provider
  const provider = infos[0].provider;

  const results: SwapInfo[] = [];

  const tokenInToSwapInfos: { [tokenIn: string]: SwapInfo[] } = {};
  for (const info of infos) {
    if (info.kind === "wrap-or-unwrap") {
      // `wrap-or-unwrap` executions go through directly
      results.push(info);
    } else {
      if (!tokenInToSwapInfos[info.tokenIn]) {
        tokenInToSwapInfos[info.tokenIn] = [];
      }
      tokenInToSwapInfos[info.tokenIn].push(info);
    }
  }

  // Anything else (eg. `swap` executions) needs to be merged together
  for (const [tokenIn, infos] of Object.entries(tokenInToSwapInfos)) {
    const fromNative = isNative(chainId, tokenIn);

    switch (provider) {
      case "uniswap": {
        const decodedExecutionData = infos.map((info) =>
          info.module.interface.decodeFunctionData(
            direction === "buy"
              ? fromNative
                ? "ethToExactOutput"
                : "erc20ToExactOutput"
              : "erc20ToExactInput",
            info.execution.data
          )
        );

        results.push({
          tokenIn,
          amountIn: infos.map((info) => bn(info.amountIn)).reduce((a, b) => a.add(b)),
          module: infos[0].module,
          kind: infos[0].kind,
          execution: {
            module: infos[0].execution.module,
            data: infos[0].module.interface.encodeFunctionData(
              direction === "buy"
                ? fromNative
                  ? "ethToExactOutput"
                  : "erc20ToExactOutput"
                : "erc20ToExactInput",
              [
                // TODO: Aggregate same token and same recipient transfers
                decodedExecutionData.map((d) => d.swaps).flat(),
                decodedExecutionData[0].refundTo,
                decodedExecutionData[0].revertIfIncomplete,
              ]
            ),
            value: infos.map((info) => bn(info.execution.value)).reduce((a, b) => a.add(b)),
          },
          provider,
        });

        break;
      }

      case "relay": {
        const decodedExecutionData = infos.map((info) =>
          info.module.interface.decodeFunctionData(
            fromNative ? "ethInputSwap" : "erc20InputSwap",
            info.execution.data
          )
        );

        results.push({
          tokenIn,
          amountIn: infos.map((info) => bn(info.amountIn)).reduce((a, b) => a.add(b)),
          module: infos[0].module,
          kind: infos[0].kind,
          execution: {
            module: infos[0].execution.module,
            data: infos[0].module.interface.encodeFunctionData(
              fromNative ? "ethInputSwap" : "erc20InputSwap",
              fromNative
                ? [
                    // TODO: Aggregate same token and same recipient transfers
                    decodedExecutionData.map((d) => d.swaps).flat(),
                    decodedExecutionData[0].refundTo,
                    decodedExecutionData[0].revertIfIncomplete,
                  ]
                : [
                    decodedExecutionData[0].tokenIn,
                    // TODO: Aggregate same token and same recipient transfers
                    decodedExecutionData.map((d) => d.swaps).flat(),
                    decodedExecutionData[0].refundTo,
                    decodedExecutionData[0].revertIfIncomplete,
                  ]
            ),
            value: infos.map((info) => bn(info.execution.value)).reduce((a, b) => a.add(b)),
          },
          provider,
        });

        break;
      }
    }
  }

  return results;
};
