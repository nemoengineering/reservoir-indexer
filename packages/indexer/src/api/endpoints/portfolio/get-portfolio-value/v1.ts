/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { toBuffer, fromBuffer, formatPrice } from "@/common/utils";
import { getCurrency } from "@/utils/currencies";
import { redb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import { getUsdPricesUniswap } from "@/utils/subgraphs";

const version = "v1";

export const getPortfolioValueV1Options: RouteOptions = {
  description: "Portfolio Value",
  notes: "Get for the given wallet its portfolio value",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      wallet: Joi.string()
        .lowercase()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
    }),
  },
  response: {
    schema: Joi.object({
      portfolio: Joi.object({
        totalUsdValue: Joi.number().unsafe().allow(null),
      }),
    }).label(`getPortfolioValue${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-portfolio-value-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;
    let totalUsdValue = 0;

    // Get the given wallet native currency balance
    const nativeBalance = await baseProvider.getBalance(query.wallet);

    (query as any).wallet = toBuffer(query.wallet);

    // Filters
    const conditions: string[] = [];

    conditions.push(`ft.owner = $/wallet/`);
    conditions.push(`ft.amount > 0`);

    const baseQuery = `
        SELECT *
        FROM ft_balances ft
        WHERE ${conditions.map((c) => `(${c})`).join(" AND ")}
      `;

    const tokensResult = await redb.manyOrNone(baseQuery, { ...query });

    // Fetch USD prices for all relevant tokens
    const tokensToFetchPrice = [Sdk.Common.Addresses.WNative[config.chainId]];
    for (const token of tokensResult) {
      tokensToFetchPrice.push(fromBuffer(token.contract));
    }

    const usdPrices = await getUsdPricesUniswap(tokensToFetchPrice);

    // Sum all ERC20 tokens
    if (tokensResult.length) {
      for (const result of tokensResult) {
        const token = await getCurrency(fromBuffer(result.contract));
        const usdPrice = usdPrices[fromBuffer(result.contract)]?.priceUSD ?? 0;
        const balance = formatPrice(result.amount, token.decimals);

        totalUsdValue += Number(balance * usdPrice);
      }
    }

    if (nativeBalance.gt(0)) {
      // Get native currency info
      const nativeCurrency = await getCurrency(Sdk.Common.Addresses.Native[config.chainId]);
      const nativeCurrencyUsdPrice =
        usdPrices[Sdk.Common.Addresses.WNative[config.chainId]]?.priceUSD ?? 0;
      const balance = formatPrice(nativeBalance, nativeCurrency.decimals);

      totalUsdValue += Number(balance * nativeCurrencyUsdPrice);
    }

    return { portfolio: { totalUsdValue: Number(totalUsdValue.toFixed(4)) } };
  },
};
