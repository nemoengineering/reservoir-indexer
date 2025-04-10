/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import _ from "lodash";
import Joi from "joi";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { Tokens } from "@/models/tokens";
import { tokenRefreshCacheJob } from "@/jobs/token-updates/token-refresh-cache-job";
import { resyncTokenAttributesCacheJob } from "@/jobs/update-attribute/resync-token-attributes-cache-job";
import { tokenReclacSupplyJob } from "@/jobs/token-updates/token-reclac-supply-job";
import { metadataIndexFetchJob } from "@/jobs/metadata-index/metadata-fetch-job";
import { orderFixesJob } from "@/jobs/order-fixes/order-fixes-job";
import { PendingFlagStatusSyncTokens } from "@/models/pending-flag-status-sync-tokens";
import { backfillTokenAsksJob } from "@/jobs/elasticsearch/asks/backfill-token-asks-job";
import { resyncTokenAttributeKeyRangeJob } from "@/jobs/update-attribute/resync-token-attribute-key-range-job";

export const postRefreshTokenOptions: RouteOptions = {
  description: "Refresh a token's orders and metadata",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      method: Joi.string().optional().valid("opensea", "zora", "onchain"),
      token: Joi.string()
        .lowercase()
        .pattern(/^0x[a-fA-F0-9]{40}:[0-9]+$/)
        .description(
          "Refresh the given token. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63:123`"
        )
        .required(),
    }),
  },
  handler: async (request: Request) => {
    if (request.headers["x-admin-api-key"] !== config.adminApiKey) {
      throw Boom.unauthorized("Wrong or missing admin API key");
    }

    const payload = request.payload as any;

    try {
      const [contract, tokenId] = payload.token.split(":");

      const token = await Tokens.getByContractAndTokenId(contract, tokenId, true);

      // If no token found
      if (_.isNull(token)) {
        throw Boom.badRequest(`Token ${payload.token} not found`);
      }

      // Update the last sync date
      const currentUtcTime = new Date().toISOString();
      await Tokens.update(contract, tokenId, { lastMetadataSync: currentUtcTime });

      // Refresh meta data
      const collection = await Tokens.getCollection(contract, tokenId);

      await metadataIndexFetchJob.addToQueue(
        [
          {
            kind: "single-token",
            data: {
              method: payload.method ?? config.metadataIndexingMethod,
              contract,
              tokenId,
              collection: collection?.id || contract,
            },
            context: "post-refresh-token",
          },
        ],
        true
      );

      await PendingFlagStatusSyncTokens.add(
        [
          {
            contract,
            tokenId,
          },
        ],
        true
      );

      // Revalidate the token orders
      await orderFixesJob.addToQueue([{ by: "token", data: { token: payload.token } }]);

      // Revalidate the token attribute cache
      await resyncTokenAttributesCacheJob.addToQueue({ contract, tokenId }, 0);

      // Refresh the token floor sell and top bid
      await tokenRefreshCacheJob.addToQueue({ contract, tokenId, checkTopBid: true });

      // Recalc supply
      await tokenReclacSupplyJob.addToQueue([{ contract, tokenId }], 0);

      // Refresh the token asks
      await backfillTokenAsksJob.addToQueue(contract, tokenId, false, true);

      // Resync the token attribute ranges
      await resyncTokenAttributeKeyRangeJob.addToQueue({ contract, tokenId });

      logger.info(
        `post-tokens-refresh-handler`,
        JSON.stringify({
          message: `Request accepted. contract=${contract}, tokenId=${tokenId}, adminApiKey=${request.headers["x-admin-api-key"]}`,
          payload,
        })
      );

      return { message: "Request accepted" };
    } catch (error) {
      logger.error(`post-tokens-refresh-handler`, `Handler failure: ${error}`);
      throw error;
    }
  },
};
