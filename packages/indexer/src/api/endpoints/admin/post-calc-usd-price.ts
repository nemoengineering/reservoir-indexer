/* eslint-disable @typescript-eslint/no-explicit-any */

import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { config } from "@/config/index";
import { getUpstreamUSDPrice } from "@/utils/prices";

export const postCalcUsdPriceOptions: RouteOptions = {
  description: "Trigger calculation of the give currency usd price",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      currencyAddress: Joi.string()
        .lowercase()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
      timestamp: Joi.number().integer().required(),
    }),
  },
  handler: async (request: Request) => {
    if (request.headers["x-admin-api-key"] !== config.adminApiKey) {
      throw Boom.unauthorized("Wrong or missing admin API key");
    }

    const payload = request.payload as any;

    await getUpstreamUSDPrice(payload.currencyAddress, payload.timestamp);

    return { message: "Request accepted" };
  },
};
