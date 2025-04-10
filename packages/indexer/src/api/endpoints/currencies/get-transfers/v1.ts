/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { redb } from "@/common/db";
import { logger } from "@/common/logger";
import { formatPrice, formatUsd, fromBuffer, regex, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import * as Sdk from "@reservoir0x/sdk";
import { getCurrency } from "@/utils/currencies";
import { Assets, ImageSize } from "@/utils/assets";

const version = "v1";

export const getTransfersV1Options: RouteOptions = {
  cache: {
    privacy: "public",
    expiresIn: 5000,
  },
  description: "Historical token transfers",
  tags: ["api", "x-deprecated"],
  plugins: {
    "hapi-swagger": {
      order: 10,
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      txHash: Joi.alternatives()
        .try(
          Joi.array().max(80).items(Joi.string().lowercase().pattern(regex.bytes32)),
          Joi.string().lowercase().pattern(regex.bytes32)
        )
        .description(
          "Filter to a particular transaction. Example: `0x04654cc4c81882ed4d20b958e0eeb107915d75730110cce65333221439de6afc`"
        ),
    }),
  },
  response: {
    schema: Joi.object({
      transfers: Joi.array().items(
        Joi.object({
          token: Joi.object({
            contract: Joi.string().lowercase().pattern(regex.address),
            metadata: Joi.object({
              image: Joi.string(),
            }),
            name: Joi.string().allow(null),
            symbol: Joi.string().uppercase().allow(null, ""),
            decimals: Joi.number().allow(null),
            totalSupply: Joi.string().allow(null),
          }),
          from: Joi.string().lowercase().pattern(regex.address),
          to: Joi.string().lowercase().pattern(regex.address),
          amount: Joi.object({
            raw: Joi.string(),
            decimal: Joi.number().unsafe(),
            usd: Joi.number(),
          }),
          block: Joi.number(),
          txHash: Joi.string().lowercase().pattern(regex.bytes32),
          logIndex: Joi.number(),
          timestamp: Joi.number(),
        })
      ),
      continuation: Joi.string().pattern(regex.base64).allow(null),
    }).label(`getTransfersBulk${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-transfers-bulk-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    let currencyAddressQueryPart = "ft_transfer_events.address";

    if (config.nativeErc20Tracker) {
      currencyAddressQueryPart = `CASE WHEN ft_transfer_events.address = $/nativeErc20TrackerAddress/ THEN $/wethAddress/ ELSE ft_transfer_events.address END`;
    }

    try {
      let baseQuery = `
        SELECT
          ft_transfer_events.address,
          ft_transfer_events."from",
          ft_transfer_events."to",
          ft_transfer_events.amount,
          upm.value AS "amount_usd",
          ft_transfer_events.tx_hash,
          ft_transfer_events."timestamp",
          ft_transfer_events.block,
          ft_transfer_events.log_index,
          extract(epoch from ft_transfer_events.updated_at) updated_ts  
        FROM ft_transfer_events 
        LEFT JOIN LATERAL (
          SELECT MIN(usd_prices_minutely."value") AS value 
          FROM usd_prices_minutely
          WHERE usd_prices_minutely.currency = ${currencyAddressQueryPart}
          AND extract(epoch from usd_prices_minutely."timestamp") >= (ft_transfer_events."timestamp" - 60)
          AND extract(epoch from usd_prices_minutely."timestamp") < (ft_transfer_events."timestamp" + 60)
          ORDER BY ft_transfer_events.timestamp DESC
          LIMIT 1
        ) upm ON TRUE
      `;

      // Filters
      const conditions: string[] = [];

      if (query.txHash) {
        if (Array.isArray(query.txHash)) {
          query.txHash = query.txHash.map((txHash: string) => toBuffer(txHash));
          conditions.push(`ft_transfer_events.tx_hash IN ($/txHash:csv/)`);
        } else {
          (query as any).txHash = toBuffer(query.txHash);
          conditions.push(`ft_transfer_events.tx_hash = $/txHash/`);
        }
      }

      if (conditions.length) {
        baseQuery += " WHERE " + conditions.map((c) => `(${c})`).join(" AND ");
      }

      baseQuery += `
          ORDER BY
            ft_transfer_events.timestamp DESC,
            ft_transfer_events.log_index DESC
        `;

      baseQuery += ` LIMIT $/limit/`;

      const rawResult = await redb.manyOrNone(baseQuery, {
        ...query,
        limit: 100,
        nativeErc20TrackerAddress: config.nativeErc20Tracker
          ? toBuffer(config.nativeErc20Tracker)
          : undefined,
        wethAddress: toBuffer(Sdk.Common.Addresses.WNative[config.chainId]),
      });

      // NOTE - this value is never changed
      const continuation = null;

      const transfers = await Promise.all(
        rawResult.map(async (r) => {
          const currency = await getCurrency(fromBuffer(r.address));

          let currencyImage = currency?.metadata?.image ?? undefined;

          if (currencyImage) {
            currencyImage = Assets.getResizedImageUrl(currencyImage, ImageSize.small);
          }

          return {
            token: {
              contract: currency.contract,
              metadata: {
                image: currencyImage,
              },
              name: currency.name,
              symbol: currency.symbol,
              decimals: currency.decimals,
              totalSupply: currency.totalSupply,
            },
            from: fromBuffer(r.from),
            to: fromBuffer(r.to),
            amount: r.amount
              ? {
                  raw: r.amount,
                  decimal: formatPrice(r.amount, currency.decimals),
                  usd: r.amount_usd ? formatUsd(r.amount_usd) : undefined,
                }
              : null,
            block: r.block,
            txHash: fromBuffer(r.tx_hash),
            logIndex: r.log_index,
            timestamp: r.timestamp,
          };
        })
      );

      return {
        transfers,
        continuation,
      };
    } catch (error) {
      logger.error(`get-tokens-transfers-${version}-handler`, `Handler failure: ${error}`);
      throw error;
    }
  },
};
