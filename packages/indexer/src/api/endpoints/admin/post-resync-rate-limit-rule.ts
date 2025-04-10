/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { syncRateLimitRulesJob } from "@/jobs/rate-limit-rules/sync-rate-limit-rules-job";

export const postResyncRateLimitRule: RouteOptions = {
  description:
    "Trigger a resync from mainnet to all other chains / specific chain of the given rate limit rule / all rate limit rules.",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      ruleId: Joi.number().description("The rule ID to sync").optional(),
      scope: Joi.string().description("Chain name to which this sync applies to").optional(),
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
      await syncRateLimitRulesJob.addToQueue({ ruleId: payload.ruleId, scope: payload.scope });
      return {
        message: `Resync triggered for${payload.ruleId ? ` rule ${payload.ruleId}` : ""}${
          payload.scope ? ` scope ${payload.scope}` : ""
        }`,
      };
    } catch (error) {
      logger.error("post-resync-rate-limit-rules", `Handler failure: ${error}`);
      throw error;
    }
  },
};
