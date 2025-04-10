/* eslint-disable @typescript-eslint/no-explicit-any */

import _ from "lodash";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { redb } from "@/common/db";
import { logger } from "@/common/logger";
import { buildContinuation, formatEth, fromBuffer, regex, splitContinuation } from "@/common/utils";
import { Assets } from "@/utils/assets";
import { getJoiPriceObject, JoiAttributeValue, JoiPrice } from "@/common/joi";
import * as Boom from "@hapi/boom";
import * as Sdk from "@reservoir0x/sdk";
import { config } from "@/config/index";

const version = "v6";

export const getAttributesExploreV6Options: RouteOptions = {
  cache: {
    privacy: "public",
    expiresIn: 10000,
  },
  description: "Explore attributes",
  notes:
    "Use this API to see stats on a specific attribute within a collection. This endpoint will return `tokenCount`, `onSaleCount`, `sampleImages`, and `floorAskPrices` by default.\n\n- `floorAskPrices` will not be returned on attributes with more than 10k tokens.",
  tags: ["api", "Attributes", "marketplace"],
  plugins: {
    "hapi-swagger": {
      order: 15,
    },
  },
  validate: {
    params: Joi.object({
      collection: Joi.string()
        .lowercase()
        .description(
          "Filter to a particular collection with collection-id. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
        ),
    }),
    query: Joi.object({
      tokenId: Joi.string().description("Filter to a particular token-id. Example: `1`"),
      includeTopBid: Joi.boolean()
        .default(false)
        .description("If true, top bid will be returned in the response."),
      excludeRangeTraits: Joi.boolean()
        .default(false)
        .description("If true, range traits will be excluded from the response."),
      excludeNumberTraits: Joi.boolean()
        .default(false)
        .description("If true, number traits will be excluded from the response."),
      attributeKey: Joi.string().description(
        "Filter to a particular attribute key. Example: `Composition`"
      ),
      maxFloorAskPrices: Joi.number()
        .integer()
        .min(1)
        .max(20)
        .default(1)
        .description("Max number of items returned in the response."),
      maxLastSells: Joi.number()
        .integer()
        .min(0)
        .max(20)
        .default(0)
        .description("Max number of items returned in the response."),
      continuation: Joi.string()
        .pattern(regex.base64)
        .description("Use continuation token to request next offset of items."),
      sortDirection: Joi.string()
        .valid("asc", "desc")
        .default("desc")
        .description("Order the items are returned in the response."),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(5000)
        .default(20)
        .description(
          "Amount of items returned in response. Default limit is 20. Max limit is 5000."
        ),
    }),
  },
  response: {
    schema: Joi.object({
      attributes: Joi.array().items(
        Joi.object({
          key: Joi.string().required(),
          value: JoiAttributeValue,
          tokenCount: Joi.number().required(),
          onSaleCount: Joi.number().required(),
          sampleImages: Joi.array().items(Joi.string().allow("", null)),
          floorAsks: Joi.array().items(
            Joi.object({
              id: Joi.string().allow(null),
              price: JoiPrice.allow(null),
              maker: Joi.string()
                .lowercase()
                .pattern(/^0x[a-fA-F0-9]{40}$/)
                .allow(null),
              validFrom: Joi.number().unsafe().allow(null),
              validUntil: Joi.number().unsafe().allow(null),
            })
          ),
          lastBuys: Joi.array().items(
            Joi.object({
              tokenId: Joi.string().required(),
              value: Joi.number().unsafe().required(),
              timestamp: Joi.number().required(),
            })
          ),
          lastSells: Joi.array().items(
            Joi.object({
              tokenId: Joi.string().required(),
              value: Joi.number().unsafe().required(),
              timestamp: Joi.number().required(),
            })
          ),
          topBid: Joi.object({
            id: Joi.string().allow(null),
            price: JoiPrice.allow(null),
            maker: Joi.string()
              .lowercase()
              .pattern(/^0x[a-fA-F0-9]{40}$/)
              .allow(null),
            validFrom: Joi.number().unsafe().allow(null),
            validUntil: Joi.number().unsafe().allow(null),
          }).optional(),
        })
      ),
      continuation: Joi.string().pattern(regex.base64).allow(null),
    }).label(`getAttributesExplore${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-attributes-explore-${version}-handler`, `Wrong response schema: ${error}`);

      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;
    const params = request.params as any;
    const conditions: string[] = [];
    let selectQuery =
      "SELECT attributes.id, kind, floor_sell_id, floor_sell_maker, floor_sell_valid_from, floor_sell_valid_to, floor_sell_value, floor_sell_currency, floor_sell_currency_value, token_count, on_sale_count, attributes.key, attributes.value, sample_images, recent_floor_values_info.*";

    conditions.push(`attributes.collection_id = $/collection/`);

    let tokenFilterQuery = "";
    if (query.tokenId) {
      tokenFilterQuery = `INNER JOIN token_attributes ta ON attributes.id = ta.attribute_id AND ta.token_id = $/tokenId/`;
    }

    if (query.attributeKey) {
      conditions.push(`attributes.key = $/attributeKey/`);
    }

    if (query.excludeRangeTraits) {
      conditions.push("attributes.kind != 'range'");
    }

    if (query.excludeNumberTraits) {
      conditions.push("attributes.kind != 'number'");
    }

    // If the client asks for multiple floor prices
    let tokensInfoQuery = `SELECT NULL AS "floor_sell_values"`;
    const tokenInfoSelectColumns = [];
    if (query.maxFloorAskPrices > 1) {
      tokenInfoSelectColumns.push(`
            (
                (array_agg(
                json_build_object(
                'id', tokens.floor_sell_id::TEXT,
                'maker', tokens.floor_sell_maker,
                'value', tokens.floor_sell_value::TEXT,
                'currency', tokens.floor_sell_currency,
                'currencyValue', tokens.floor_sell_currency_value::TEXT,
                'validFrom', tokens.floor_sell_valid_from,
                'validTo', tokens.floor_sell_valid_to
              ) ORDER BY tokens.floor_sell_value)
                 FILTER (WHERE tokens.floor_sell_value IS NOT NULL)
                )::text[]
            )[1:${query.maxFloorAskPrices}] AS "floor_sells"
      `);
    }

    if (query.maxLastSells) {
      tokenInfoSelectColumns.push(`
            ((array_agg(
              json_build_object(
                'tokenId', tokens.token_id,
                'value', tokens.last_sell_value::text,
                'timestamp', tokens.last_sell_timestamp
              ) ORDER BY tokens.last_sell_timestamp DESC
            ) FILTER (WHERE tokens.last_sell_value IS NOT NULL AND tokens.last_sell_value > 0) )::json[])[1:${query.maxLastSells}] AS "last_sells",
            ((array_agg(
              json_build_object(
                'tokenId', tokens.token_id,
                'value', tokens.last_buy_value::text,
                'timestamp', tokens.last_buy_timestamp
              ) ORDER BY tokens.last_buy_timestamp DESC
            ) FILTER (WHERE tokens.last_buy_value IS NOT NULL))::json[])[1:${query.maxLastSells}] AS "last_buys"
      `);
    }

    if (!_.isEmpty(tokenInfoSelectColumns)) {
      tokensInfoQuery = `
        SELECT ${_.join(tokenInfoSelectColumns, ",")}
        FROM token_attributes
        JOIN tokens ON token_attributes.contract = tokens.contract AND token_attributes.token_id = tokens.token_id
        WHERE token_attributes.attribute_id = attributes.id
        GROUP BY token_attributes.attribute_id
      `;
    }

    let topBidQuery = "";
    if (query.includeTopBid) {
      selectQuery += ", top_buy_info.*";

      topBidQuery = `LEFT JOIN LATERAL (
          SELECT  token_sets.top_buy_id,
                  token_sets.top_buy_value,
                  token_sets.top_buy_maker,
                  orders.currency AS top_buy_currency,
                  orders.fee_breakdown AS top_buy_fee_breakdown,
                  orders.currency_price AS top_buy_currency_price,
                  orders.currency_value AS top_buy_currency_value,
                  date_part('epoch', lower(orders.valid_between)) AS "top_buy_valid_from",
                  coalesce(nullif(date_part('epoch', upper(orders.valid_between)), 'Infinity'), 0) AS "top_buy_valid_until"
          FROM token_sets
          JOIN orders ON token_sets.top_buy_id = orders.id
          WHERE token_sets.attribute_id = attributes.id
          ORDER BY token_sets.top_buy_value DESC NULLS LAST
          LIMIT 1
      ) "top_buy_info" ON TRUE`;
    }

    let attributesQuery = `
            ${selectQuery}
            FROM attributes
            ${tokenFilterQuery}
             ${topBidQuery}
            JOIN LATERAL (
                ${tokensInfoQuery}
            ) "recent_floor_values_info" ON TRUE
            `;

    if (query.continuation) {
      const contArr = splitContinuation(query.continuation, /^([0-9]+|null)_[^_]+_[^_]+$/);

      if (contArr.length !== 3) {
        throw Boom.badRequest("Invalid continuation string used");
      }

      const sign = query.sortDirection == "desc" ? "<" : ">";

      if (contArr[0] !== "null") {
        conditions.push(
          `((floor_sell_value, key, value) ${sign} ($/contFloorSellValue/, $/contKey/, $/contValue/)
                  OR floor_sell_value IS NULL)`
        );
      } else {
        conditions.push(
          `(floor_sell_value IS NULL AND (key, value) ${sign} ($/contKey/, $/contValue/))`
        );
      }

      (query as any).contFloorSellValue = contArr[0];
      (query as any).contKey = contArr[1];
      (query as any).contValue = contArr[2];
    }
    if (conditions.length) {
      attributesQuery += " WHERE " + conditions.map((c) => `(${c})`).join(" AND ");
    }
    const sortDirection = query.sortDirection === "desc" ? "desc" : "asc";

    attributesQuery += `ORDER BY floor_sell_value ${sortDirection} NULLS LAST, key ${sortDirection}, value ${sortDirection} LIMIT $/limit/`;

    const attributesData = await redb.manyOrNone(attributesQuery, { ...query, ...params });

    let continuation = null;
    if (attributesData.length === query.limit) {
      continuation = buildContinuation(
        attributesData[attributesData.length - 1].floor_sell_value +
          "_" +
          attributesData[attributesData.length - 1].key +
          "_" +
          attributesData[attributesData.length - 1].value
      );
    }

    // If no attributes found return here
    if (_.isEmpty(attributesData)) {
      return { attributes: [] };
    }

    const result = attributesData.map(async (r) => {
      let floorAsks = [];

      if (Number(r.token_count) <= 10000) {
        if (query.maxFloorAskPrices > 1) {
          floorAsks = (r.floor_sells || []).map(async (floor_sell: any) => {
            const floorAsk = JSON.parse(floor_sell);

            return {
              id: floorAsk.id,
              price: await getJoiPriceObject(
                {
                  gross: {
                    amount: String(floorAsk.currencyValue ?? floorAsk.value),
                    nativeAmount: String(floorAsk.value),
                  },
                },
                floorAsk.currency
                  ? _.replace(floorAsk.currency, "\\x", "0x")
                  : Sdk.Common.Addresses.Native[config.chainId]
              ),
              maker: _.replace(floorAsk.maker, "\\x", "0x"),
              validFrom: floorAsk.validFrom,
              validUntil: floorAsk.validTo ? floorAsk.validTo : null,
            };
          });
        } else if (r.floor_sell_value) {
          floorAsks = [
            {
              id: r.floor_sell_id,
              price: await getJoiPriceObject(
                {
                  gross: {
                    amount: String(r.floor_sell_currency_value ?? r.floor_sell_value),
                    nativeAmount: String(r.floor_sell_value),
                  },
                },
                r.floor_sell_currency
                  ? fromBuffer(r.floor_sell_currency)
                  : Sdk.Common.Addresses.Native[config.chainId]
              ),
              maker: fromBuffer(r.floor_sell_maker),
              validFrom: r.floor_sell_valid_from,
              validUntil: r.floor_sell_valid_to ? r.floor_sell_valid_to : null,
            },
          ];
        }
      }

      const topBidCurrency = r.top_buy_currency
        ? fromBuffer(r.top_buy_currency)
        : Sdk.Common.Addresses.WNative[config.chainId];

      return {
        key: r.key,
        value: r.value,
        tokenCount: Number(r.token_count),
        onSaleCount: Number(r.on_sale_count),
        sampleImages: Assets.getResizedImageURLs(r.sample_images) || [],
        floorAsks: await Promise.all(floorAsks),
        lastBuys: query.maxLastSells
          ? (r.last_buys || []).map(({ tokenId, value, timestamp }: any) => ({
              tokenId: `${tokenId}`,
              value: formatEth(value),
              timestamp: Number(timestamp),
            }))
          : undefined,
        lastSells: query.maxLastSells
          ? (r.last_sells || []).map(({ tokenId, value, timestamp }: any) => ({
              tokenId: `${tokenId}`,
              value: formatEth(value),
              timestamp: Number(timestamp),
            }))
          : undefined,
        topBid: query.includeTopBid
          ? {
              id: r.top_buy_id,
              price: r.top_buy_value
                ? await getJoiPriceObject(
                    {
                      net: {
                        amount: r.top_buy_currency_value ?? r.top_buy_value,
                        nativeAmount: r.top_buy_value,
                      },
                      gross: {
                        amount: r.top_buy_currency_price ?? r.top_buy_price,
                        nativeAmount: r.top_buy_price,
                      },
                    },
                    topBidCurrency
                  )
                : null,
              maker: r.top_buy_maker ? fromBuffer(r.top_buy_maker) : null,
              validFrom: r.top_buy_valid_from,
              validUntil: r.top_buy_value ? r.top_buy_valid_until : null,
            }
          : undefined,
      };
    });

    return { attributes: await Promise.all(result), continuation };
  },
};
