/* eslint-disable @typescript-eslint/no-explicit-any */

import _ from "lodash";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";
import { logger } from "@/common/logger";
import { regex } from "@/common/utils";

import { getJoiActivityObj, JoiActivityTypeMapping } from "@/common/joi";

import * as ActivitiesIndex from "@/elasticsearch/indexes/activities";

import { MetadataStatus } from "@/models/metadata-status";

import { ActivitiesCollectionCache } from "@/models/activities-collection-cache";
import { ActivitiesTokenCache } from "@/models/activities-token-cache";

const version = "v1";

export const getPortfolioActivityV1Options: RouteOptions = {
  description: "Portfolio activity",
  notes:
    "This API can be used to build a feed for a user including sales, asks, transfers, mints, bids, cancelled bids, and cancelled asks types.",
  tags: ["api", "x-deprecated", "marketplace"],
  cache: {
    privacy: "public",
    expiresIn: 5000,
  },
  plugins: {
    "hapi-swagger": {
      order: 1,
      deprecated: true,
    },
  },
  validate: {
    query: Joi.object({
      wallets: Joi.alternatives()
        .try(
          Joi.array()
            .items(Joi.string().lowercase().pattern(regex.address))
            .min(1)
            .max(50)
            .description(
              "Array of wallet addresses. Max is 50. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
            ),
          Joi.string()
            .lowercase()
            .pattern(regex.address)
            .description(
              "Array of wallet addresses. Max is 50. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
            )
        )
        .required(),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(50)
        .default(50)
        .description("Amount of items returned in response. Max limit is 20."),
      continuation: Joi.string().description(
        "Use continuation token to request next offset of items."
      ),
      onlyParentActivities: Joi.boolean()
        .default(false)
        .description("If true, will include only activities."),
      tokens: Joi.alternatives(
        Joi.array().items(Joi.string().lowercase().pattern(regex.address)),
        Joi.string().lowercase().pattern(regex.address)
      ).description(
        "Filter to one or more tokens. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
      ),
      types: Joi.alternatives()
        .try(
          Joi.array().items(
            Joi.string()
              .lowercase()
              .valid(..._.values(JoiActivityTypeMapping))
          ),
          Joi.string()
            .lowercase()
            .valid(..._.values(JoiActivityTypeMapping))
        )
        .description("Types of events returned in response. Example: 'types=sale'"),
    }),
  },
  response: {
    schema: Joi.object({
      continuation: Joi.string().allow(null),
      activities: Joi.array().items(
        Joi.object({
          type: Joi.string().description(
            "Possible types returned: `ask`, `ask_cancel`, `bid`, `bid_cancel`, `sale`, `mint, and `transfer`."
          ),
          fromAddress: Joi.string(),
          toAddress: Joi.string().allow(null),
          data: Joi.any(),
          timestamp: Joi.string(),
        })
      ),
    }).label(`getPortfolioActivity${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`get-portfolio-activity-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const query = request.query as any;

    if (query.types && !_.isArray(query.types)) {
      query.types = [query.types];
    }

    const types = query.types?.map((value: string) =>
      value.startsWith("nft_") ? value.slice(4) : value
    );

    if (!_.isArray(query.wallets)) {
      query.wallets = [query.wallets];
    }

    if (query.tokens && !_.isArray(query.tokens)) {
      query.tokens = [query.tokens];
    }

    const { activities, continuation } = await ActivitiesIndex.search({
      types,
      users: query.wallets,
      fungibles: query.tokens,
      limit: query.limit,
      continuation: query.continuation,
      excludeChildActivities: query.onlyParentActivities,
    });

    let tokensMetadata: any[] = [];
    let collectionsMetadata: any[] = [];
    const disabledCollectionMetadata = await MetadataStatus.get(
      activities.map((activity) => activity.collection?.id ?? "")
    );

    try {
      tokensMetadata = await ActivitiesTokenCache.getTokens(activities);
    } catch {
      // Do nothing
    }

    try {
      collectionsMetadata = await ActivitiesCollectionCache.getCollections(activities);
    } catch {
      // Do nothing
    }

    const result = _.map(activities, async (activity) => {
      const tokenMetadata = tokensMetadata?.find(
        (token) => token.contract == activity.contract && `${token.token_id}` == activity.token?.id
      );

      const collectionMetadata = collectionsMetadata?.find(
        (collection) => collection.id == activity.collection?.id
      );

      const tokenMetadataDisabled = Boolean(tokenMetadata?.metadata_disabled);
      const collectionMetadataDisabled = disabledCollectionMetadata[activity.collection?.id ?? ""];

      return getJoiActivityObj(
        activity,
        tokenMetadata,
        collectionMetadata,
        tokenMetadataDisabled,
        collectionMetadataDisabled
      );
    });

    return { activities: await Promise.all(result), continuation };
  },
};
