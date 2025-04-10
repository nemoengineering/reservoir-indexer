import { Provider } from "@ethersproject/abstract-provider";
import { BigNumberish } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import axios from "axios";

import { TransferDetail, SwapInfo } from "./index";
import { isNative } from "../utils";
import { bn } from "../../../utils";

export const generateBuyExecutions = async (
  chainId: number,
  provider: Provider,
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: BigNumberish,
  options: {
    module: Contract;
    transfers: TransferDetail[];
    refundTo: string;
    revertIfIncomplete: boolean;
  }
): Promise<SwapInfo> => {
  return _generateSwapExecutions(chainId, provider, fromTokenAddress, toTokenAddress, amount, {
    direction: "buy",
    ...options,
  });
};

export const generateSellExecutions = async (
  chainId: number,
  provider: Provider,
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: BigNumberish,
  options: {
    module: Contract;
    transfers: TransferDetail[];
    refundTo: string;
    revertIfIncomplete: boolean;
  }
): Promise<SwapInfo> => {
  return _generateSwapExecutions(chainId, provider, fromTokenAddress, toTokenAddress, amount, {
    direction: "sell",
    ...options,
  });
};

const _generateSwapExecutions = async (
  chainId: number,
  _provider: Provider,
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: BigNumberish,
  options: {
    direction: "sell" | "buy";
    module: Contract;
    transfers: TransferDetail[];
    refundTo: string;
    revertIfIncomplete: boolean;
  }
): Promise<SwapInfo> => {
  const quote: {
    steps: {
      items: {
        data: {
          to: string;
          data: string;
          value: string;
        };
      }[];
    }[];
    details: {
      currencyIn: { amount: string };
      currencyOut: { amount: string };
    };
  } = await axios
    .post("https://api.relay.link/quote", {
      user: options.module.address,
      recipient: options.refundTo,
      originChainId: chainId,
      destinationChainId: chainId,
      originCurrency: fromTokenAddress,
      destinationCurrency: toTokenAddress,
      tradeType: options.direction === "sell" ? "EXACT_INPUT" : "EXACT_OUTPUT",
      amount: amount.toString(),
      slippageTolerance: "200",
      // For forcing direct same-chain swaps in all cases
      useExternalLiquidity: true,
    })
    .then((response) => response.data);

  const isBuy = options.direction === "buy";
  const fromNative = isNative(chainId, fromTokenAddress);

  const calls = quote.steps.map((s) => s.items.map((i) => i.data)).flat();
  const execution = {
    module: options.module.address,
    data: options.module.interface.encodeFunctionData(
      fromNative ? "ethInputSwap" : "erc20InputSwap",
      fromNative
        ? [
            [
              {
                tokenOut: toTokenAddress,
                calls,
                transfers: options.transfers,
              },
            ],
            options.refundTo,
            options.revertIfIncomplete,
          ]
        : [
            fromTokenAddress,
            [
              {
                tokenOut: toTokenAddress,
                calls,
                transfers: options.transfers,
              },
            ],
            options.refundTo,
            options.revertIfIncomplete,
          ]
    ),
    value: calls
      .map((c) => bn(c.value))
      .reduce((a, b) => a.add(b))
      .toString(),
  };

  return {
    tokenIn: fromTokenAddress,
    amountIn: isBuy ? quote.details.currencyIn.amount : amount,
    amountOut: isBuy ? amount : quote.details.currencyOut.amount,
    module: options.module,
    execution,
    kind: "swap",
    provider: "relay",
  };
};
