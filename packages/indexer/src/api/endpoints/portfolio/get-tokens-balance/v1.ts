/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { regex, toBuffer, fromBuffer, formatPrice } from "@/common/utils";
import { getCurrency } from "@/utils/currencies";
import { redb } from "@/common/db";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";
import _ from "lodash";
import { AddressZero } from "@ethersproject/constants";
import { Assets, ImageSize } from "@/utils/assets";
import { getUsdPricesUniswap } from "@/utils/subgraphs";
import { FtBalances } from "@/models/ft-balances";

const version = "v1";

export const getTokensBalanceV1Options: RouteOptions = {
  description: "Tokens Balance",
  notes: "Get for the given wallet its tokens balance",
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
      contracts: Joi.alternatives()
        .try(
          Joi.array().items(Joi.string().lowercase().pattern(regex.address)).max(20),
          Joi.string().lowercase().pattern(regex.address)
        )
        .description(
          "Array of contracts. Max amount is 20. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
        ),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(20)
        .default(20)
        .description("Amount of items returned in response. Max limit is 20."),
      continuation: Joi.string().allow(null),
    }),
  },
  response: {
    schema: Joi.object({
      tokens: Joi.array().items(
        Joi.object({
          contract: Joi.string().lowercase().pattern(regex.address),
          metadata: Joi.object({
            image: Joi.string().allow("", null),
          }),
          name: Joi.string(),
          symbol: Joi.string().uppercase().allow(null, ""),
          decimals: Joi.number().allow(null),
          totalSupply: Joi.string().allow(null),
          balance: Joi.object({
            raw: Joi.string().pattern(regex.number),
            decimal: Joi.number().unsafe(),
          }),
          usdPrice: Joi.number().unsafe().allow(null),
          usdValue: Joi.number().unsafe().allow(null),
          usdPriceChange: Joi.object({
            "1day": Joi.number().allow(null),
          }),
        })
      ),
      continuation: Joi.string().allow(null),
    }).label(`getTokensBalance${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-tokens-balance-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    const nativeBalance = await FtBalances.getNativeBalance(query.wallet);

    (query as any).wallet = toBuffer(query.wallet);

    // Filters
    const conditions: string[] = [];

    conditions.push(`ft.owner = $/wallet/`);
    conditions.push(`ft.amount > 0`);

    if (query.contracts) {
      if (!Array.isArray(query.contracts)) {
        query.contracts = [query.contracts];
      }

      query.contractsBuffer = query.contracts.map((contract: string) => toBuffer(contract));
      conditions.push(`ft.contract IN ($/contractsBuffer:csv/)`);
    }

    if (config.nativeErc20Tracker) {
      query.nativeErc20Tracker = toBuffer(config.nativeErc20Tracker);
      conditions.push(`ft.contract != $/nativeErc20Tracker/`);
    }

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

    const result = tokensResult.map(async (r) => {
      const contract = fromBuffer(r.contract);

      const currency = await getCurrency(contract);
      const balance = formatPrice(r.amount, currency.decimals);
      const usdPrice = usdPrices[contract]?.priceUSD ?? 0;

      return {
        contract,
        metadata: {
          image: currency.metadata?.image
            ? Assets.getResizedImageUrl(currency.metadata.image, ImageSize.small)
            : undefined,
        },
        name: currency.name,
        symbol: currency.symbol,
        decimals: currency.decimals,
        totalSupply: currency?.totalSupply ? String(currency.totalSupply) : null,
        balance: {
          decimal: balance,
          raw: r.amount,
        },
        usdPrice: usdPrice,
        usdValue: Number((balance * usdPrice).toFixed(4)),
        usdPriceChange: {
          "1day": usdPrices[contract]?.oneDayChange,
        },
      };
    });

    const tokens = await Promise.all(result);

    if (
      nativeBalance.gt(0) &&
      (_.isEmpty(query.contracts) || query.contracts.includes(AddressZero))
    ) {
      // Get native currency info
      const nativeCurrency = await getCurrency(Sdk.Common.Addresses.Native[config.chainId]);
      const nativeCurrencyUsdPrice =
        usdPrices[Sdk.Common.Addresses.WNative[config.chainId]]?.priceUSD ?? 0;
      const balance = formatPrice(nativeBalance.toString(), nativeCurrency.decimals);

      tokens.push({
        contract: Sdk.Common.Addresses.Native[config.chainId],
        metadata: {
          image: nativeCurrency.metadata?.image
            ? Assets.getResizedImageUrl(nativeCurrency.metadata.image, ImageSize.small)
            : undefined,
        },
        name: nativeCurrency.name,
        symbol: nativeCurrency.symbol,
        decimals: nativeCurrency.decimals,
        totalSupply: null,
        balance: {
          decimal: balance,
          raw: nativeBalance.toString(),
        },
        usdPrice: nativeCurrencyUsdPrice,
        usdValue: Number((balance * nativeCurrencyUsdPrice).toFixed(4)),
        usdPriceChange: {
          "1day": usdPrices[Sdk.Common.Addresses.WNative[config.chainId]]?.oneDayChange,
        },
      });
    }

    // Sort the response
    const sortedTokens = _.reverse(_.sortBy(tokens, ["usdValue"]));
    const slicedTokens = sortedTokens.slice(
      Number(query.continuation ?? 0),
      Number(query.continuation ?? 0) + query.limit
    );

    // Pagination
    let continuation: string | null = null;

    if (sortedTokens.length > Number(query.continuation ?? 0) + query.limit) {
      continuation = `${Number(query.continuation ?? 0) + query.limit}`;
    }

    return { tokens: slicedTokens, continuation };
  },
};
