/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import _ from "lodash";
import Joi from "joi";

import { redb } from "@/common/db";
import { logger } from "@/common/logger";
import { JoiOrderDepth, getJoiOrderDepthObject } from "@/common/joi";
import { fromBuffer, regex, toBuffer } from "@/common/utils";

const version = "v1";

export const getOrdersDepthV1Options: RouteOptions = {
  description: "Orders depth",
  notes: "Get the depth of a token or collection.",
  tags: ["api", "Orders"],
  plugins: {
    "hapi-swagger": {
      order: 5,
    },
  },
  validate: {
    query: Joi.object({
      side: Joi.string().lowercase().valid("buy", "sell").required(),
      token: Joi.string()
        .lowercase()
        .pattern(regex.token)
        .description(
          "Filter to a particular token. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63:123`."
        ),
      collection: Joi.string()
        .lowercase()
        .description(
          "Filter to a particular collection. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`."
        ),
      attributes: Joi.object()
        .when("side", {
          is: "buy",
          then: Joi.allow(),
          otherwise: Joi.forbidden(),
        })
        .unknown()
        .description(
          "Filter to a particular attributes within a collection (Relevant only for buy orders). Example: `attributes[Mouth]=Bored` (Collection must be passed as well when filtering by attributes)"
        ),
      displayCurrency: Joi.string()
        .lowercase()
        .pattern(regex.address)
        .description("Return all prices in this currency."),
      groupByFloorAsk: Joi.boolean()
        .when("side", {
          is: "sell",
          then: Joi.valid(true, false),
          otherwise: Joi.valid(false),
        })
        .description("Return all prices in this currency."),
      precision: Joi.number()
        .min(1)
        .max(8)
        .default(4)
        .description(`Number of decimals by which to group by the orders`),
    })
      .or("token", "collection")
      .oxor("token", "collection")
      .with("attributes", "collection")
      .with("groupByFloorAsk", "collection"),
  },
  response: {
    schema: Joi.object({
      depth: JoiOrderDepth,
    }).label(`getOrdersDepth${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-orders-depth-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    try {
      const side = query.side as "buy" | "sell";
      const limit = 1000;
      const values: { [key: string]: any } = {
        side,
        contract: query.token
          ? toBuffer(query.token.split(":")[0])
          : toBuffer(query.collection.split(":")[0]),
        tokenId: query.token && query.token.split(":")[1],
        tokenSetId: query.token && `token:${query.token}`,
        collection: query.collection,
        limit,
      };

      let ordersQuery;

      // If we are grouping by floor ask, we need to use the tokens table
      if (query.groupByFloorAsk) {
        ordersQuery = `
          SELECT
            orders.kind,
            orders.price,
            orders.currency_price,
            orders.currency,
            orders.quantity_remaining,
            orders.raw_data,
            orders.maker,
            orders.fee_bps
          FROM tokens
          JOIN orders ON orders.id = tokens.floor_sell_id
            ${
              query.token
                ? `
                  WHERE contract = $/contract/
                  AND token_id = $/tokenId/`
                : ""
            }
            ${
              query.collection
                ? `
                  WHERE collection_id = $/collection/`
                : ""
            }
          ORDER BY tokens.floor_sell_value ASC
          LIMIT $/limit/
        `;
      } else {
        ordersQuery = `
          SELECT
            orders.kind,
            orders.price,
            orders.currency_price,
            orders.currency,
            orders.quantity_remaining,
            orders.raw_data,
            orders.maker,
            orders.fee_bps
          FROM orders
          ${
            query.token
              ? side === "buy"
                ? `
                  JOIN token_sets_tokens
                    ON orders.token_set_id = token_sets_tokens.token_set_id
                `
                : ""
              : ""
          }
          ${
            query.collection
              ? side === "buy" // If it's a buy and contract wide collection
                ? `
                  JOIN token_sets
                    ON orders.token_set_id = token_sets.id
                    AND orders.token_set_schema_hash = token_sets.schema_hash
                `
                : !query.collection.match(regex.address) // If it's a sell and shared collection
                ? `
                  JOIN token_sets_tokens
                    ON orders.token_set_id = token_sets_tokens.token_set_id
                  JOIN tokens
                    ON token_sets_tokens.contract = tokens.contract
                    AND token_sets_tokens.token_id = tokens.token_id
                `
                : "" // If it's a sell and contract wide collection
              : "" // If it's a sell
          }
          WHERE orders.side = $/side/
          AND orders.fillability_status = 'fillable'
          AND orders.approval_status = 'approved'
          ${
            query.token
              ? side === "buy"
                ? `
                  AND token_sets_tokens.contract = $/contract/
                  AND token_sets_tokens.token_id = $/tokenId/
                `
                : " AND orders.token_set_id = $/tokenSetId/"
              : ""
          }
          ${
            query.collection
              ? side === "buy"
                ? `
                  ${
                    query.attributes
                      ? ""
                      : `
                      AND token_sets.collection_id = $/collection/
                      AND token_sets.attribute_id IS NULL
                      AND orders.contract = $/contract/
                      `
                  }
                `
                : !query.collection.match(regex.address)
                ? `
                  AND orders.contract = $/contract/
                  AND tokens.collection_id = $/collection/
                `
                : " AND orders.contract = $/contract/"
              : ""
          }
          ${
            query.attributes
              ? `
                AND token_sets.attribute_id IN (
                  SELECT id
                  FROM attributes
                  WHERE collection_id = $/collection/
                  AND (key, value) IN (${Object.entries(query.attributes)
                    .map(([key, value], index) => {
                      values[`attributeKey${index}`] = key;

                      if (_.isArray(value)) {
                        return value
                          .map((v, i) => {
                            values[`attributeValue${index}${i}`] = v;
                            return `($/attributeKey${index}/, $/attributeValue${index}${i}/)`;
                          })
                          .join(", ");
                      } else {
                        values[`attributeValue${index}`] = value;
                        return `($/attributeKey${index}/, $/attributeValue${index}/)`;
                      }
                    })
                    .join(", ")})
                  )`
              : ""
          }
          ORDER BY orders.value ${side === "buy" ? "DESC" : "ASC"}
          LIMIT $/limit/
        `;
      }

      const results = await redb.manyOrNone(ordersQuery, values);

      const depth = await Promise.all(
        results.map(async (r) =>
          getJoiOrderDepthObject(
            r.kind,
            r.currency_price ?? r.price,
            fromBuffer(r.currency),
            fromBuffer(r.maker),
            r.quantity_remaining,
            r.raw_data,
            side === "buy" ? r.fee_bps : undefined,
            query.displayCurrency,
            query.precision
          )
        )
      )
        .then((r) => r.flat())
        .then((r) =>
          _.reduce(
            r,
            (aggregate, value) => {
              const groupInfo = aggregate.get(value.price);
              if (groupInfo) {
                aggregate.set(value.price, {
                  quantity: groupInfo.quantity + value.quantity,
                  makers: groupInfo.makers.add(value.maker),
                });
              } else {
                aggregate.set(value.price, {
                  quantity: value.quantity,
                  makers: new Set([value.maker]),
                });
              }
              return aggregate;
            },
            new Map<number, { quantity: number; makers: Set<string> }>()
          )
        )
        .then((r) => [...r.entries()])
        .then((r) =>
          r.map(([price, groupInfo]) => ({
            price,
            quantity: groupInfo.quantity,
            uniqueMakers: groupInfo.makers.size,
          }))
        )
        .then((r) => _.orderBy(r, ["price"], [side === "buy" ? "desc" : "asc"]));

      return { depth };
    } catch (error) {
      logger.error(
        `get-orders-depth-${version}-handler`,
        `Handler failure: ${JSON.stringify(error)}`
      );
      throw error;
    }
  },
};
