import { Provider } from "@ethersproject/abstract-provider";
import { BigNumberish } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { parseEther } from "@ethersproject/units";
import { QUOTER_ADDRESSES } from "@uniswap/sdk-core";

import * as Common from "../common";
import { bn } from "../utils";

import QuoterV2ABI from "./abis/QuoterV2.json";

const FEE = 10000; // 1% liquidity fee

export const getPoolQuote = async ({
  pool,
  side,
  quantity,
  slippage,
  provider,
}: {
  pool: string;
  side: string;
  quantity: number;
  slippage: number;
  provider: Provider;
}) => {
  const chainId = await provider.getNetwork().then((n) => n.chainId);
  const weth = Common.Addresses.WNative[chainId];
  const quoter = new Contract(QUOTER_ADDRESSES[chainId], QuoterV2ABI, provider);
  const erc20zAmount = parseEther(quantity.toString());
  if (side === "buy") {
    const { amountIn: wethRequired }: { amountIn: BigNumberish } =
      await quoter.callStatic.quoteExactOutputSingle({
        tokenIn: weth,
        tokenOut: pool,
        amount: erc20zAmount,
        fee: FEE,
        sqrtPriceLimitX96: 0,
      });

    let price = bn(wethRequired);
    if (slippage) {
      price = price.add(price.mul(slippage).div(10000));
    }

    return {
      price: price.toString(),
    };
  } else {
    const { amountOut: wethAmount }: { amountOut: BigNumberish } =
      await quoter.callStatic.quoteExactInputSingle({
        tokenIn: pool,
        tokenOut: weth,
        amountIn: erc20zAmount,
        fee: FEE,
        sqrtPriceLimitX96: 0,
      });

    let price = bn(wethAmount);
    if (slippage) {
      price = price.sub(price.mul(slippage).div(10000));
    }

    return {
      price: price.toString(),
    };
  }
};
