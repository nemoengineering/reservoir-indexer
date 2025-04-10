/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import * as Sdk from "@reservoir0x/sdk";
import Joi from "joi";
import _ from "lodash";

import { redb } from "@/common/db";
import {
  getJoiPriceObject,
  getJoiSourceObject,
  getJoiTokenObject,
  JoiPrice,
  JoiSource,
} from "@/common/joi";
import { logger } from "@/common/logger";
import {
  bn,
  buildContinuation,
  fromBuffer,
  regex,
  splitContinuation,
  toBuffer,
} from "@/common/utils";
import { config } from "@/config/index";
import { Sources } from "@/models/sources";
import { Assets, ImageSize } from "@/utils/assets";
import { isOrderNativeOffChainCancellable } from "@/utils/offchain-cancel";
import { parseMetadata } from "@/api/endpoints/tokens/get-user-tokens/v8";
import { MaxUint256 } from "@ethersproject/constants";

const version = "v1";

export const getNftsBalanceV1Options: RouteOptions = {
  description: "NFTS Balance",
  notes:
    "Get tokens held by a user, along with ownership information such as associated orders and date acquired.",
  tags: ["api", "x-deprecated", "marketplace"],
  plugins: {
    "hapi-swagger": {
      order: 9,
    },
  },
  validate: {
    query: Joi.object({
      wallet: Joi.string()
        .lowercase()
        .pattern(regex.address)
        .required()
        .description(
          "Filter to a particular user. Example: `0xF296178d553C8Ec21A2fBD2c5dDa8CA9ac905A00`"
        ),
      collection: Joi.alternatives().try(
        Joi.array()
          .items(Joi.string().lowercase())
          .min(1)
          .max(100)
          .description(
            "Array of collections. Max limit is 100. Example: `collections[0]: 0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
          ),
        Joi.string()
          .lowercase()
          .description(
            "Array of collections. Max limit is 100. Example: `collections[0]: 0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
          )
      ),
      sortBy: Joi.string()
        .valid("acquiredAt", "floorAskPrice")
        .default("acquiredAt")
        .description(
          "Order the items are returned in the response. Options are `acquiredAt`, `floorAskPrice`.  `floorAskPrice` is the collection floor ask"
        ),
      sortDirection: Joi.string()
        .lowercase()
        .valid("asc", "desc")
        .default("desc")
        .description("Order the items are returned in the response."),
      continuation: Joi.string()
        .pattern(regex.base64)
        .description("Use continuation token to request next offset of items."),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(200)
        .default(20)
        .description("Amount of items returned in response. Max limit is 200."),
      includeTopBid: Joi.boolean()
        .default(false)
        .description("If true, top bid will be returned in the response."),
      excludeSpam: Joi.boolean()
        .default(false)
        .description("If true, will filter any tokens marked as spam."),
    }),
  },
  response: {
    schema: Joi.object({
      nfts: Joi.array().items(
        Joi.object({
          nft: Joi.object({
            contract: Joi.string(),
            tokenId: Joi.string(),
            kind: Joi.string().description("Can be erc721, erc115, etc."),
            name: Joi.string().allow("", null),
            image: Joi.string().allow("", null),
            imageSmall: Joi.string().allow("", null),
            imageLarge: Joi.string().allow("", null),
            metadata: Joi.object().allow(null),
            description: Joi.string().allow("", null),
            supply: Joi.number()
              .unsafe()
              .allow(null)
              .description("Can be higher than one if erc1155."),
            remainingSupply: Joi.number().unsafe().allow(null),
            rarityRank: Joi.number()
              .allow(null)
              .description("No rarity rank for collections over 100k"),
            media: Joi.string().allow(null),
            isFlagged: Joi.boolean().default(false),
            isSpam: Joi.boolean().default(false),
            isNsfw: Joi.boolean().default(false),
            metadataDisabled: Joi.boolean().default(false),
            lastFlagUpdate: Joi.string().allow("", null),
            lastFlagChange: Joi.string().allow("", null),
            collection: Joi.object({
              id: Joi.string().allow(null),
              name: Joi.string().allow("", null),
              floorAsk: {
                id: Joi.string().allow(null),
                price: JoiPrice.allow(null),
                maker: Joi.string().lowercase().pattern(regex.address).allow(null),
                validFrom: Joi.number().unsafe().allow(null),
                validUntil: Joi.number().unsafe().allow(null),
                source: JoiSource.allow(null),
              },
            }),
            topBid: Joi.object({
              id: Joi.string().allow(null),
              price: JoiPrice.allow(null),
              source: JoiSource.allow(null),
            })
              .optional()
              .description("Can be null if not active bids."),
            floorAsk: Joi.object({
              id: Joi.string().allow(null),
              price: JoiPrice.allow(null),
              maker: Joi.string().lowercase().pattern(regex.address).allow(null),
              validFrom: Joi.number().unsafe().allow(null),
              validUntil: Joi.number().unsafe().allow(null),
              quantityFilled: Joi.number().unsafe().allow(null),
              quantityRemaining: Joi.number().unsafe().allow(null),
              dynamicPricing: Joi.object({
                kind: Joi.string().valid("dutch", "pool"),
                data: Joi.object(),
              }).description("Can be null if no active ask."),
              source: JoiSource.allow(null),
            }),
          }),
          ownership: Joi.object({
            tokenCount: Joi.string(),
            onSaleCount: Joi.string(),
            floorAsk: Joi.object({
              id: Joi.string().allow(null),
              price: JoiPrice.allow(null),
              maker: Joi.string().lowercase().pattern(regex.address).allow(null),
              kind: Joi.string().allow(null),
              validFrom: Joi.number().unsafe().allow(null),
              validUntil: Joi.number().unsafe().allow(null),
              source: JoiSource.allow(null),
              rawData: Joi.object().optional().allow(null),
              isNativeOffChainCancellable: Joi.boolean().optional(),
            }).description("Can be null if no asks."),
            acquiredAt: Joi.string().allow(null),
          }),
        })
      ),
      continuation: Joi.string().pattern(regex.base64).allow(null),
    }).label(`getNftsBalances${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-nfts-balances-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request, response) => {
    const params = request.params as any;
    const query = request.query as any;

    // Filters
    (query as any).user = toBuffer(query.wallet);

    const tokensCollectionFilters: string[] = [];
    const tokensExcludeCollectionFilters: string[] = [];
    const nftBalanceCollectionFilters: string[] = [];
    const collections: string[] = [];
    let listBasedContract = false;

    const addCollectionToFilter = (id: string) => {
      const i = nftBalanceCollectionFilters.length;
      collections.push(id);

      if (id.match(/^0x[a-f0-9]{40}:\d+:\d+$/g)) {
        const [contract, startTokenId, endTokenId] = id.split(":");

        (query as any)[`contract${i}`] = toBuffer(contract);
        (query as any)[`startTokenId${i}`] = startTokenId;
        (query as any)[`endTokenId${i}`] = endTokenId;

        nftBalanceCollectionFilters.push(`
          (nft_balances.contract = $/contract${i}/
          AND nft_balances.token_id >= $/startTokenId${i}/
          AND nft_balances.token_id <= $/endTokenId${i}/)
        `);
      } else if (id.match(/^0x[a-f0-9]{40}:[a-zA-Z]+-.+$/g)) {
        // List based collections
        listBasedContract = true;
        const collectionParts = id.split(":");

        (query as any)[`collection${i}`] = id;
        (query as any)[`contract${i}`] = toBuffer(collectionParts[0]);

        tokensCollectionFilters.push(`
          collection_id = $/collection${i}/
        `);

        nftBalanceCollectionFilters.push(`(nft_balances.contract = $/contract${i}/)`);
      } else {
        // Contract wide collection
        (query as any)[`contract${i}`] = toBuffer(id);
        (query as any)[`collection${i}`] = id;

        nftBalanceCollectionFilters.push(`(nft_balances.contract = $/contract${i}/)`);
      }
    };

    if (query.collection) {
      if (!Array.isArray(query.collection)) {
        query.collection = [query.collection];
      }

      query.collection.forEach(addCollectionToFilter);
    }

    const tokensFilter: string[] = [];

    const selectCollectionFloorData = `
      , 
      c.floor_sell_id AS collection_floor_sell_id,
      c.floor_sell_value AS collection_floor_sell_value,
      c.floor_sell_maker AS collection_floor_sell_maker,
      c.floor_sell_valid_between AS collection_floor_sell_valid_between,
      c.floor_sell_source_id_int AS collection_floor_sell_source_id_int
    `;

    const selectFloorData = `
      t.floor_sell_id,
      t.floor_sell_maker,
      t.floor_sell_valid_from,
      t.floor_sell_valid_to,
      t.floor_sell_source_id_int,
      t.floor_sell_value,
      t.floor_sell_currency,
      t.floor_sell_currency_value
    `;

    const tokensConditions: string[] = [];

    if (query.excludeSpam) {
      tokensConditions.push(`t.is_spam IS NULL OR t.is_spam <= 0`);
    }

    let tokensJoin = `
      JOIN LATERAL (
        SELECT
          t.token_id,
          t.name,
          t.image,
          COALESCE(t.metadata_version::TEXT, t.image_version::TEXT) AS image_version,
          (t.metadata ->> 'image_mime_type')::TEXT AS image_mime_type,
          (t.metadata ->> 'media_mime_type')::TEXT AS media_mime_type,
          t.metadata,
          t.media,
          t.description,
          t.rarity_rank,
          t.collection_id,
          t.rarity_score,
          t.supply,
          t.remaining_supply,
          t.last_sell_value,
          t.last_buy_value,
          t.last_sell_timestamp,
          t.last_buy_timestamp,
          t.is_flagged,
          t.is_spam AS t_is_spam,
          t.nsfw_status AS t_nsfw_status,
          t.metadata_disabled AS t_metadata_disabled,
          t.last_flag_update,
          t.last_flag_change,
          null AS top_bid_id,
          null AS top_bid_price,
          null AS top_bid_value,
          null AS top_bid_currency,
          null AS top_bid_currency_price,
          null AS top_bid_currency_value,
          null AS top_bid_source_id_int,
          ${selectFloorData}
        FROM tokens t
        WHERE b.token_id = t.token_id
        AND b.contract = t.contract
        ${
          tokensConditions.length
            ? "AND " + tokensConditions.map((c) => `(${c})`).join(" AND ")
            : ""
        }
        AND ${
          tokensCollectionFilters.length ? "(" + tokensCollectionFilters.join(" OR ") + ")" : "TRUE"
        }
        AND ${
          tokensExcludeCollectionFilters.length
            ? "(" + tokensExcludeCollectionFilters.join(" OR ") + ")"
            : "TRUE"
        }
      ) t ON TRUE
    `;

    if (query.includeTopBid) {
      tokensJoin = `
        JOIN LATERAL (
          SELECT
            t.token_id,
            t.name,
            t.image,
            COALESCE(t.metadata_version::TEXT, t.image_version::TEXT) AS image_version,
          (t.metadata ->> 'image_mime_type')::TEXT AS image_mime_type,
          (t.metadata ->> 'media_mime_type')::TEXT AS media_mime_type,
            t.metadata,
            t.media,
            t.description,
            t.rarity_rank,
            t.collection_id,
            t.rarity_score,
            t.supply,
            t.remaining_supply,
            t.last_sell_value,
            t.last_buy_value,
            t.last_sell_timestamp,
            t.last_buy_timestamp,
            t.is_flagged,
            t.is_spam AS t_is_spam,
            t.nsfw_status AS t_nsfw_status,
            t.metadata_disabled AS t_metadata_disabled,
            t.last_flag_update,
            t.last_flag_change,
            ${selectFloorData}
          FROM tokens t
          WHERE b.token_id = t.token_id
          AND b.contract = t.contract
          ${
            tokensConditions.length
              ? "AND " + tokensConditions.map((c) => `(${c})`).join(" AND ")
              : ""
          }
          AND ${
            tokensCollectionFilters.length
              ? "(" + tokensCollectionFilters.join(" OR ") + ")"
              : "TRUE"
          }
        ) t ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            o.id AS "top_bid_id",
            o.price AS "top_bid_price",
            o.value AS "top_bid_value",
            o.currency AS "top_bid_currency",
            o.currency_price AS "top_bid_currency_price",
            o.currency_value AS "top_bid_currency_value",
            o.source_id_int AS "top_bid_source_id_int"
          FROM "orders" "o"
          JOIN "token_sets_tokens" "tst"
            ON "o"."token_set_id" = "tst"."token_set_id"
          WHERE "tst"."contract" = "b"."contract"
            AND "tst"."token_id" = "b"."token_id"
            AND "o"."side" = 'buy'
            AND "o"."fillability_status" = 'fillable'
            AND "o"."approval_status" = 'approved'
            AND EXISTS(
              SELECT FROM "nft_balances" "nb"
                WHERE "nb"."contract" = "b"."contract"
                AND "nb"."token_id" = "b"."token_id"
                AND "nb"."amount" > 0
                AND "nb"."owner" != "o"."maker"
                AND (
                  "o"."taker" IS NULL
                  OR "o"."taker" = '\\x0000000000000000000000000000000000000000'
                  OR "o"."taker" = "nb"."owner"
                )
            )
          ORDER BY "o"."value" DESC
          LIMIT 1
        ) "y" ON TRUE
      `;
    }

    // Sorting
    let nftBalanceSorting = "";
    let userCollectionsSorting = "";
    const limit = `LIMIT $/limit/`;

    if (query.sortBy === "acquiredAt") {
      nftBalanceSorting = `ORDER BY acquired_at ${query.sortDirection}, token_id ${query.sortDirection}`;
    } else if (query.sortBy === "floorAskPrice") {
      userCollectionsSorting = `ORDER BY c.floor_sell_value ${query.sortDirection} NULLS LAST, token_id ${query.sortDirection}`;
    }

    // Continuation
    let continuationFilter = "";
    if (query.continuation) {
      const [sortByValue, collectionId, tokenId] = splitContinuation(
        query.continuation,
        /^(?:[0-9]+|null)_[A-Za-z0-9:-]+_[0-9]+$/
      );

      (query as any).sortByValue = sortByValue;
      (query as any).collectionId = collectionId;
      (query as any).tokenId = tokenId;
      query.sortDirection = query.sortDirection || "desc";
      if (query.sortBy === "acquiredAt") {
        continuationFilter = ` AND (acquired_at, nft_balances.token_id) ${
          query.sortDirection == "desc" ? "<" : ">"
        } (to_timestamp($/sortByValue/), $/tokenId/)`;
      } else {
        const sortByKey = "c.floor_sell_value";

        if (sortByValue === "null") {
          continuationFilter = `AND ${sortByKey} IS NULL AND nft_balances.token_id ${
            query.sortDirection == "desc" ? "<" : ">"
          } $/tokenId/`;
        } else {
          continuationFilter = `AND (COALESCE(${sortByKey}, '0'), nft_balances.token_id) ${
            query.sortDirection == "desc" ? "<" : ">"
          } ($/sortByValue/, $/tokenId/)`;
        }
      }
    }

    let ucTable = "";
    if (query.sortBy === "floorAskPrice" || !_.isEmpty(collections)) {
      ucTable = `
        SELECT collection_id, COALESCE(c.token_set_id != CONCAT('contract:', collection_id), true) AS "shared_contract", c.*
        FROM user_collections uc
        JOIN collections c ON c.id = uc.collection_id
        WHERE owner = $/user/
        AND uc.token_count > 0
        ${!_.isEmpty(collections) ? `AND uc.collection_id IN ($/collections:list/)` : ""}
        ${query.excludeSpam ? `AND (uc.is_spam IS NULL OR uc.is_spam <= 0)` : ""}
        ${
          query.sortBy === "floorAskPrice"
            ? `ORDER BY floor_sell_value ${query.sortDirection} NULLS LAST`
            : ""
        }
      `;
    }

    // When filtering tokens based on data which doesn't exist in the nft_balances we need to sort on the full results set
    const limitFullResultsSet =
      query.sortBy === "floorAskPrice" ||
      listBasedContract ||
      query.excludeSpam ||
      !_.isEmpty(ucTable);

    const sortFullResultsSet = query.sortBy === "acquiredAt" && !_.isEmpty(ucTable);

    const baseQuery = `
        SELECT b.contract, b.token_id, b.token_count, extract(epoch from b.acquired_at) AS acquired_at, b.last_token_appraisal_value,
               t.name, t.image, t.metadata AS token_metadata, t.media, t.rarity_rank, t.collection_id,
               t.supply, t.remaining_supply, t.description,
               t.rarity_score, t.t_is_spam, t.t_nsfw_status, t.image_version, t.image_mime_type, t.media_mime_type,
               t.floor_sell_id, t.floor_sell_maker, t.floor_sell_valid_from, t.floor_sell_valid_to,
               t.floor_sell_source_id_int, t.floor_sell_value, t.floor_sell_currency, t.floor_sell_currency_value,
               top_bid_id, top_bid_price, top_bid_value, top_bid_currency, top_bid_currency_price, top_bid_currency_value, top_bid_source_id_int,
               o.currency AS collection_floor_sell_currency, o.currency_price AS collection_floor_sell_currency_price, o.currency_value AS collection_floor_sell_currency_value, o.token_set_id AS collection_floor_sell_token_set_id,
               c.name as collection_name, c.token_count as collection_token_count, con.kind, con.symbol, extract(epoch from con.deployed_at) AS contract_deployed_at, c.metadata, c.royalties, (c.metadata ->> 'safelistRequestStatus')::TEXT AS "opensea_verification_status",
               c.royalties_bps, ot.kind AS ownership_floor_sell_kind, c.slug, c.is_spam AS c_is_spam, c.nsfw_status AS c_nsfw_status, (c.metadata ->> 'imageUrl')::TEXT AS collection_image, c.metadata_disabled AS c_metadata_disabled, t_metadata_disabled,
               c.image_version AS "collection_image_version",
               ot.value as ownership_floor_sell_value, ot.currency_value as ownership_floor_sell_currency_value, ot.currency as ownership_floor_sell_currency, ot.maker as ownership_floor_sell_maker,
                date_part('epoch', lower(ot.valid_between)) AS "ownership_floor_sell_valid_from",
                COALESCE(nullif(date_part('epoch', upper(ot.valid_between)), 'Infinity'), 0) AS "ownership_floor_sell_valid_to",
               ot.source_id_int as ownership_floor_sell_source_id_int, ot.id as ownership_floor_sell_id,
               (
                    CASE WHEN ot.value IS NOT NULL
                    THEN 1
                    ELSE 0
                    END
               ) AS on_sale_count
               ${selectCollectionFloorData}
        FROM
            ${ucTable ? `(${ucTable}) AS c JOIN LATERAL ` : ""} (
            SELECT amount AS token_count, nft_balances.token_id, nft_balances.contract, acquired_at, last_token_appraisal_value
            FROM nft_balances
            ${
              ucTable
                ? `JOIN tokens t on nft_balances.contract = t.contract AND nft_balances.token_id = t.token_id AND CASE WHEN c.shared_contract IS TRUE THEN c.collection_id = t.collection_id ELSE true END`
                : ""
            }
            WHERE owner = $/user/
              AND ${
                tokensFilter.length
                  ? "(nft_balances.contract, nft_balances.token_id) IN ($/tokensFilter:raw/)"
                  : "TRUE"
              }
              AND amount > 0
              ${
                ucTable
                  ? `AND nft_balances.contract = c.contract`
                  : `AND ${
                      nftBalanceCollectionFilters.length
                        ? "(" + nftBalanceCollectionFilters.join(" OR ") + ")"
                        : "TRUE"
                    }`
              }
              ${continuationFilter}
              ${sortFullResultsSet ? "" : nftBalanceSorting}
              ${limitFullResultsSet ? "" : limit}
          ) AS b ${ucTable ? ` ON TRUE` : ""}
          ${tokensJoin}
          ${
            ucTable
              ? ""
              : `${
                  listBasedContract || query.excludeSpam ? "" : "LEFT "
                }JOIN collections c ON c.id = t.collection_id ${
                  query.excludeSpam ? `AND (c.is_spam IS NULL OR c.is_spam <= 0)` : ""
                }`
          }
          LEFT JOIN orders o ON o.id = ${
            query.useNonFlaggedFloorAsk ? "c.floor_sell_id" : "c.non_flagged_floor_sell_id"
          }
          LEFT JOIN contracts con ON b.contract = con.address
          ${
            query.onlyListed ? "" : "LEFT"
          } JOIN orders ot ON ot.id = CASE WHEN con.kind = 'erc1155' THEN (
            SELECT
              id
            FROM
              orders
              JOIN token_sets_tokens ON orders.token_set_id = token_sets_tokens.token_set_id
            WHERE
              con.kind = 'erc1155'
              AND token_sets_tokens.contract = b.contract
              AND token_sets_tokens.token_id = b.token_id
              AND orders.side = 'sell'
              AND orders.fillability_status = 'fillable'
              AND orders.approval_status = 'approved'
              AND orders.maker = $/user/
            ORDER BY
              orders.value ASC
            LIMIT
              1
          ) ELSE t.floor_sell_id END
          ${userCollectionsSorting}
          ${sortFullResultsSet ? nftBalanceSorting : ""}
          ${limitFullResultsSet ? limit : ""}
      `;

    const userTokens = await redb.manyOrNone(baseQuery, { ...query, ...params, collections });

    let continuation = null;
    if (userTokens.length === query.limit) {
      if (query.sortBy === "acquiredAt") {
        continuation = buildContinuation(
          _.toInteger(userTokens[userTokens.length - 1].acquired_at) +
            "_" +
            userTokens[userTokens.length - 1].collection_id +
            "_" +
            userTokens[userTokens.length - 1].token_id
        );
      } else if (query.sortBy === "floorAskPrice") {
        continuation = buildContinuation(
          (userTokens[userTokens.length - 1].collection_floor_sell_value
            ? _.toInteger(userTokens[userTokens.length - 1].collection_floor_sell_value)
            : "null") +
            "_" +
            userTokens[userTokens.length - 1].collection_id +
            "_" +
            userTokens[userTokens.length - 1].token_id
        );
      }
    }

    const sources = await Sources.getInstance();
    const result = userTokens.map(async (r) => {
      const metadata = parseMetadata(r, r.token_metadata);

      const contract = fromBuffer(r.contract);
      const tokenId = r.token_id;

      // Use default currencies for backwards compatibility with entries
      // that don't have the currencies cached in the tokens table
      const floorAskCurrency = r.floor_sell_currency
        ? fromBuffer(r.floor_sell_currency)
        : Sdk.Common.Addresses.Native[config.chainId];
      const ownershipFloorAskCurrency = r.ownership_floor_sell_currency
        ? fromBuffer(r.ownership_floor_sell_currency)
        : Sdk.Common.Addresses.Native[config.chainId];
      const collectionFloorAskCurrency = r.collection_floor_sell_currency
        ? fromBuffer(r.collection_floor_sell_currency)
        : Sdk.Common.Addresses.Native[config.chainId];
      const topBidCurrency = r.top_bid_currency
        ? fromBuffer(r.top_bid_currency)
        : Sdk.Common.Addresses.WNative[config.chainId];
      const floorAskSource = r.floor_sell_value
        ? sources.get(Number(r.floor_sell_source_id_int), contract, tokenId)
        : undefined;
      const ownershipFloorAskSource = r.ownership_floor_sell_value
        ? sources.get(Number(r.ownership_floor_sell_source_id_int), contract, tokenId)
        : undefined;
      const collectionFloorAskSource =
        r.collection_floor_sell_value && r.collection_floor_sell_token_set_id
          ? sources.get(
              Number(r.collection_floor_sell_source_id_int),
              r.collection_floor_sell_token_set_id.split(":")[1],
              r.collection_floor_sell_token_set_id.split(":")[2]
            )
          : undefined;
      const topBidSource = r.top_bid_source_id_int
        ? sources.get(Number(r.top_bid_source_id_int), contract, tokenId)
        : undefined;
      const collectionFloorAskValidBetween = r.collection_floor_sell_valid_between
        ? r.collection_floor_sell_valid_between.slice(1, -1).split(",")
        : undefined;
      const acquiredTime = new Date(r.acquired_at * 1000).toISOString();

      let dynamicPricing = undefined;
      if (query.includeDynamicPricing) {
        // Add missing royalties on top of the raw prices
        const missingRoyalties = query.normalizeRoyalties
          ? ((r.floor_sell_missing_royalties ?? []) as any[])
              .map((mr: any) => bn(mr.amount))
              .reduce((a, b) => a.add(b), bn(0))
          : bn(0);

        if (r.floor_sell_raw_data) {
          if (r.floor_sell_dynamic && r.floor_sell_order_kind === "seaport") {
            const order = new Sdk.SeaportV11.Order(config.chainId, r.floor_sell_raw_data);

            // Dutch auction
            dynamicPricing = {
              kind: "dutch",
              data: {
                price: {
                  start: await getJoiPriceObject(
                    {
                      gross: {
                        amount: bn(order.getMatchingPrice(order.params.startTime))
                          .add(missingRoyalties)
                          .toString(),
                      },
                    },
                    floorAskCurrency,
                    query.displayCurrency
                  ),
                  end: await getJoiPriceObject(
                    {
                      gross: {
                        amount: bn(order.getMatchingPrice(order.params.endTime))
                          .add(missingRoyalties)
                          .toString(),
                      },
                    },
                    floorAskCurrency,
                    query.displayCurrency
                  ),
                },
                time: {
                  start: order.params.startTime,
                  end: order.params.endTime,
                },
              },
            };
          } else if (
            ["sudoswap", "sudoswap-v2", "nftx", "nftx-v3", "zora-v4"].includes(
              r.floor_sell_order_kind
            )
          ) {
            // Pool orders
            dynamicPricing = {
              kind: "pool",
              data: {
                pool: r.floor_sell_raw_data.pair ?? r.floor_sell_raw_data.pool,
                prices: await Promise.all(
                  (r.floor_sell_raw_data.extra.prices as string[])
                    .filter((price) =>
                      bn(price).lte(bn(r.floor_sell_raw_data.extra.floorPrice || MaxUint256))
                    )
                    .map((price) =>
                      getJoiPriceObject(
                        {
                          gross: {
                            amount: bn(price).add(missingRoyalties).toString(),
                          },
                        },
                        floorAskCurrency,
                        query.displayCurrency
                      )
                    )
                ),
              },
            };
          }
        }
      }

      return {
        nft: getJoiTokenObject(
          {
            contract: contract,
            tokenId: tokenId,
            kind: r.kind,
            name: r.name,
            image: Assets.getResizedImageUrl(
              r.image,
              ImageSize.medium,
              r.image_version,
              r.image_mime_type
            ),
            imageSmall: Assets.getResizedImageUrl(
              r.image,
              ImageSize.small,
              r.image_version,
              r.image_mime_type
            ),
            imageLarge: Assets.getResizedImageUrl(
              r.image,
              ImageSize.large,
              r.image_version,
              r.image_mime_type
            ),
            metadata: Object.values(metadata).every((el) => el === undefined)
              ? undefined
              : metadata,
            description: r.description,
            rarityRank: r.rarity_rank,
            supply: !_.isNull(r.supply) ? r.supply : null,
            remainingSupply: !_.isNull(r.remaining_supply) ? r.remaining_supply : null,
            media: Assets.getResizedImageUrl(
              r.media,
              undefined,
              r.image_version,
              r.media_mime_type
            ),
            isFlagged: Boolean(Number(r.is_flagged)),
            isSpam: Number(r.t_is_spam) > 0 || Number(r.c_is_spam) > 0,
            isNsfw: Number(r.t_nsfw_status) > 0 || Number(r.c_nsfw_status) > 0,
            metadataDisabled:
              Boolean(Number(r.c_metadata_disabled)) || Boolean(Number(r.t_metadata_disabled)),
            lastFlagUpdate: r.last_flag_update ? new Date(r.last_flag_update).toISOString() : null,
            lastFlagChange: r.last_flag_change ? new Date(r.last_flag_change).toISOString() : null,
            collection: {
              id: r.collection_id,
              name: r.collection_name,
              floorAsk: {
                id: r.collection_floor_sell_id,
                price: r.collection_floor_sell_id
                  ? await getJoiPriceObject(
                      {
                        gross: {
                          amount:
                            r.collection_floor_sell_currency_value ?? r.collection_floor_sell_value,
                          nativeAmount: r.collection_floor_sell_value,
                        },
                      },
                      collectionFloorAskCurrency,
                      query.displayCurrency
                    )
                  : null,
                maker: r.collection_floor_sell_maker
                  ? fromBuffer(r.collection_floor_sell_maker)
                  : null,
                validFrom: collectionFloorAskValidBetween
                  ? Math.round(
                      new Date(collectionFloorAskValidBetween[0].slice(1, -1)).getTime() / 1000
                    )
                  : null,
                validUntil: collectionFloorAskValidBetween
                  ? collectionFloorAskValidBetween[1] === "infinity"
                    ? 0
                    : Math.round(
                        new Date(collectionFloorAskValidBetween[1].slice(1, -1)).getTime() / 1000
                      )
                  : null,
                source: getJoiSourceObject(collectionFloorAskSource),
              },
            },
            topBid: query.includeTopBid
              ? {
                  id: r.top_bid_id,
                  price: r.top_bid_value
                    ? await getJoiPriceObject(
                        {
                          net: {
                            amount: r.top_bid_currency_value ?? r.top_bid_value,
                            nativeAmount: r.top_bid_value,
                          },
                          gross: {
                            amount: r.top_bid_currency_price ?? r.top_bid_price,
                            nativeAmount: r.top_bid_price,
                          },
                        },
                        topBidCurrency,
                        query.displayCurrency
                      )
                    : null,
                  source: getJoiSourceObject(topBidSource),
                }
              : undefined,
            floorAsk: {
              id: r.floor_sell_id,
              price: r.floor_sell_id
                ? await getJoiPriceObject(
                    {
                      gross: {
                        amount: r.floor_sell_currency_value ?? r.floor_sell_value,
                        nativeAmount: r.floor_sell_value,
                      },
                    },
                    floorAskCurrency,
                    query.displayCurrency
                  )
                : null,
              maker: r.floor_sell_maker ? fromBuffer(r.floor_sell_maker) : null,
              validFrom: r.floor_sell_value ? r.floor_sell_valid_from : null,
              validUntil: r.floor_sell_value ? r.floor_sell_valid_to : null,
              dynamicPricing,
              source: getJoiSourceObject(floorAskSource),
            },
          },
          r.t_metadata_disabled,
          r.c_metadata_disabled
        ),
        ownership: {
          tokenCount: String(r.token_count),
          onSaleCount: String(r.on_sale_count),
          floorAsk: {
            id: r.ownership_floor_sell_id,
            price: r.ownership_floor_sell_id
              ? await getJoiPriceObject(
                  {
                    gross: {
                      amount: r.ownership_floor_sell_currency_value ?? r.ownership_floor_sell_value,
                      nativeAmount: r.ownership_floor_sell_value,
                    },
                  },
                  ownershipFloorAskCurrency,
                  query.displayCurrency
                )
              : null,
            maker: r.ownership_floor_sell_maker ? fromBuffer(r.ownership_floor_sell_maker) : null,
            kind: r.ownership_floor_sell_kind,
            validFrom: r.ownership_floor_sell_value ? r.ownership_floor_sell_valid_from : null,
            validUntil: r.ownership_floor_sell_value ? r.ownership_floor_sell_valid_to : null,
            source: getJoiSourceObject(ownershipFloorAskSource),
            rawData: query.includeRawData ? r.ownership_floor_sell_raw_data : undefined,
            isNativeOffChainCancellable: query.includeRawData
              ? isOrderNativeOffChainCancellable(r.ownership_floor_sell_raw_data)
              : undefined,
          },
          acquiredAt: acquiredTime,
        },
      };
    });

    if (query.includeTopBid) {
      return response
        .response({
          nfts: await Promise.all(result),
          continuation,
        })
        .header("cache-control", `max-age=60, must-revalidate, public`);
    }

    return {
      nfts: await Promise.all(result),
      continuation,
    };
  },
};
