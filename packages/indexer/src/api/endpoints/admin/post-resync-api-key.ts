/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { syncApiKeysJob } from "@/jobs/api-keys/sync-api-keys-job";

export const postResyncApiKey: RouteOptions = {
  description:
    "Trigger a resync from mainnet to all other chains / specific chain of the given api key / all api keys.",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      apiKey: Joi.string()
        .description("The api key to resync, If not passed will resync all keys")
        .optional(),
      scope: Joi.string().description("Chain name to which this resync applies to").optional(),
    }),
  },
  handler: async (request: Request) => {
    if (request.headers["x-admin-api-key"] !== config.adminApiKey) {
      throw Boom.unauthorized("Wrong or missing admin API key");
    }

    if (config.chainId !== 1) {
      throw Boom.badRequest("This API can be called only on mainnet");
    }

    const payload = request.payload as any;

    try {
      await syncApiKeysJob.addToQueue({ apiKey: payload.apiKey, scope: payload.scope });
      return {
        message: `Resync triggered for${payload.apiKey ? ` key ${payload.apiKey}` : ""}${
          payload.scope ? ` scope ${payload.scope}` : ""
        }`,
      };
    } catch (error) {
      logger.error("post-resync-api-key", `Handler failure: ${error}`);
      throw error;
    }
  },
};
