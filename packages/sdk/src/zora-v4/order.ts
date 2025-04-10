import { Provider } from "@ethersproject/abstract-provider";

import * as Types from "./types";
import { getPoolQuote } from "./helpers";
import { lc, s } from "../utils";

export class Order {
  public chainId: number;
  public params: Types.OrderParams;

  constructor(chainId: number, params: Types.OrderParams) {
    this.chainId = chainId;
    try {
      this.params = normalize(params);
    } catch {
      throw new Error("Invalid params");
    }
  }

  async getPrice(provider: Provider) {
    const { price } = await getPoolQuote({
      pool: this.params.pool,
      side: this.params.side,
      slippage: 0,
      quantity: 1,
      provider,
    });

    return price;
  }

  async getQuote(slippage: number, provider: Provider) {
    return getPoolQuote({
      pool: this.params.pool,
      side: this.params.side,
      slippage,
      quantity: 1,
      provider,
    });
  }
}

const normalize = (order: Types.OrderParams): Types.OrderParams => {
  // Perform some normalization operations on the order:
  // - convert bignumbers to strings where needed
  // - convert strings to numbers where needed
  // - lowercase all strings

  return {
    pool: lc(order.pool),
    price: s(order.price),
    side: order.side,
    collection: lc(order.collection),
    tokenId: s(order.tokenId),
    extra: {
      prices: order.extra?.prices ? order.extra.prices.map(s) : [],
    },
  };
};
