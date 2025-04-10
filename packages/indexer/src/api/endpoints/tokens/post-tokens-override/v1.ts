/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from "lodash";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";
import { logger } from "@/common/logger";
import { ApiKeyManager } from "@/models/api-keys";
import * as Boom from "@hapi/boom";
import {
  ActionsLogContext,
  actionsLogJob,
  ActionsLogOrigin,
} from "@/jobs/general-tracking/actions-log-job";
import { getCurrency } from "@/utils/currencies";
import { Currencies } from "@/models/currencies";
import { PubSub } from "@/pubsub/index";
import { Channel } from "@/pubsub/channels";
import { config } from "@/config/index";

const version = "v1";

export const postTokensOverrideV1Options: RouteOptions = {
  description: "Override tokens",
  notes: "Override tokens metadata",
  tags: ["api", "Management", "marketplace"],
  plugins: {
    "hapi-swagger": {
      order: 31,
    },
  },
  validate: {
    headers: Joi.object({
      "x-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    params: Joi.object({
      token: Joi.string()
        .lowercase()
        .required()
        .description(
          "The token id to update. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
        ),
    }),
    payload: Joi.object({
      icon: Joi.string().allow(null).optional().description("URL of icon to set"),
      name: Joi.string().allow(null).optional().description("Name to set"),
    })
      .min(1)
      .description(
        "Params that can be passed in order to override existing ones, to disable override pass null"
      ),
  },
  response: {
    schema: Joi.object({
      message: Joi.string(),
    }).label(`postTokensOverride${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(`post-tokens-override-${version}-handler`, `Wrong response schema: ${error}`);
      throw error;
    },
  },
  handler: async (request: Request) => {
    const params = request.params as any;
    const payload = request.payload as any;

    const apiKey = await ApiKeyManager.getApiKey(request.headers["x-api-key"]);

    if (config.adminApiKey !== apiKey?.key) {
      if (_.isNull(apiKey)) {
        throw Boom.unauthorized("Invalid API key");
      }

      if (!apiKey.permissions?.token_data_override) {
        throw Boom.unauthorized("Not allowed");
      }
    }

    const currency = await getCurrency(params.token);

    if (!currency) {
      return { message: `token ${params.token} not found` };
    }

    try {
      // Update DB
      await Currencies.updateCurrency(currency.contract, {
        image: payload.icon,
        adminImage: payload.icon,
        adminName: payload.name,
      });

      // Update other pods currency was updated
      await PubSub.publish(
        Channel.CurrencyUpdated,
        JSON.stringify({ currency: currency.contract })
      );

      // Track the override
      await actionsLogJob.addToQueue([
        {
          context: ActionsLogContext.TokenDataOverride,
          origin: ActionsLogOrigin.API,
          actionTakerIdentifier: apiKey.key,
          contract: currency.contract,
          data: payload,
        },
      ]);

      return { message: `token ${currency.contract} updated with ${JSON.stringify(payload)}` };
    } catch (error) {
      logger.error(`post-tokens-override-${version}-handler`, `Handler failure: ${error}`);
      throw error;
    }
  },
};
