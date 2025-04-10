/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { Sources } from "@/models/sources";
import { regex } from "@/common/utils";

export const postCreateSourceOptions: RouteOptions = {
  description: "Create source",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      domain: Joi.string().pattern(regex.domain).required(),
      icon: Joi.string().allow(""),
      title: Joi.string().allow(""),
      tokenUrl: Joi.string().allow(""),
      description: Joi.string().allow(""),
      allowedApiKeys: Joi.array().items(Joi.string()),
    }),
  },
  handler: async (request: Request) => {
    if (request.headers["x-admin-api-key"] !== config.adminApiKey) {
      throw Boom.unauthorized("Wrong or missing admin API key");
    }

    const payload = request.payload as any;

    try {
      const sources = await Sources.getInstance();

      const source = await sources.getOrInsert(payload.domain);

      if (source) {
        await sources.update(payload.domain, {
          title: payload.title,
          icon: payload.icon,
          tokenUrl: payload.tokenUrl,
          description: payload.description,
          allowedApiKeys: payload.allowedApiKeys,
        });
      }

      return {
        message: `Source ${payload.domain} was created.`,
      };
    } catch (error) {
      logger.error("post-create-source-handler", `Handler failure: ${error}`);
      throw error;
    }
  },
};
