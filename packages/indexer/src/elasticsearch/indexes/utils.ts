/* eslint-disable @typescript-eslint/no-explicit-any */

import { ErrorCause } from "@elastic/elasticsearch/lib/api/types";
import { getUSDAndNativePrices } from "@/utils/prices";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import { formatUsd, now } from "@/common/utils";

export const isRetryableError = (error: any): boolean => {
  let retryableError =
    (error as any).meta?.meta?.aborted ||
    (error as any).meta?.body?.error?.caused_by?.type === "node_not_connected_exception";

  const rootCause = (error as any).meta?.body?.error?.root_cause as ErrorCause[];

  if (!retryableError && rootCause?.length) {
    retryableError = ["node_disconnected_exception", "node_not_connected_exception"].includes(
      rootCause[0].type
    );
  }

  return retryableError;
};

export const getUsdPrice = async (price: string): Promise<number> => {
  let usdPrice = 0;

  try {
    const prices = await getUSDAndNativePrices(
      Sdk.Common.Addresses.Native[config.chainId],
      price,
      now(),
      {
        onlyUSD: true,
      }
    );

    usdPrice = formatUsd(prices.usdPrice!);
  } catch {
    // SKIP
  }

  return usdPrice;
};
