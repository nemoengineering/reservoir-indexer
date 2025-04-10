import { formatEther } from "@ethersproject/units";
import axios from "axios";

import { bn, now } from "@/common/utils";
import { config } from "@/config/index";
import { BaseOrderBuildOptions } from "@/orderbook/orders/blur/build/utils";

interface BuildOrderOptions extends BaseOrderBuildOptions {
  quantity?: number;
}

export const build = async (options: BuildOrderOptions) => {
  const minimumExpirationTime = 10 * 24 * 3600;

  const currentTime = now();
  const expirationTime = options.expirationTime ?? currentTime + minimumExpirationTime;

  if (expirationTime < currentTime + minimumExpirationTime) {
    throw new Error("Expiration time too low (must be at least 10 days)");
  }

  const formattedPrice = formatEther(options.weiPrice);
  if (formattedPrice.includes(".") && formattedPrice.split(".")[1].length > 2) {
    throw new Error("The minimum precision of the price can be 0.01");
  }

  const response: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signData: { value: any; domain: any; types: any };
    marketplaceData: string;
  } = await axios
    .post(`${config.orderFetcherBaseUrl}/api/blur-create-bid`, {
      contract: options.contract,
      weiPrice: bn(options.weiPrice)
        .div(options.quantity ?? 1)
        .toString(),
      quantity: options.quantity ?? 1,
      maker: options.maker,
      expirationTime,
      authToken: options.authToken,
      chainId: config.chainId,
    })
    .then((response) => response.data.data);

  if (response?.signData?.domain) {
    response.signData.domain.chainId = Number(response.signData.domain.chainId);
  }

  return {
    signData: response.signData,
    marketplaceData: response.marketplaceData,
  };
};
