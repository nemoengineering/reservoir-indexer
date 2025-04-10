import * as Boom from "@hapi/boom";
import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { orderRevalidationsJob } from "@/jobs/order-fixes/order-revalidations-job";
import { ridb } from "@/common/db";
import { toBuffer } from "@/common/utils";

export const postRevalidateOrderOptions: RouteOptions = {
  description: "Revalidate an existing order",
  tags: ["api", "x-admin"],
  validate: {
    headers: Joi.object({
      "x-admin-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      id: Joi.string(),
      maker: Joi.string(),
      side: Joi.string().valid("ask", "bid"),
      status: Joi.string().valid("active", "inactive").required(),
    })
      .or("id", "maker")
      .oxor("id", "maker")
      .with("side", "maker"),
  },
  handler: async (request: Request) => {
    if (request.headers["x-admin-api-key"] !== config.adminApiKey) {
      throw Boom.unauthorized("Wrong or missing admin API key");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = request.payload as any;

    try {
      if (payload.id) {
        await orderRevalidationsJob.addToQueue([
          { by: "id", data: { id: payload.id, status: payload.status } },
        ]);
      } else if (payload.maker) {
        const query = `
          SELECT id
          FROM orders
          WHERE maker = $/maker/
          ${payload.side ? `AND side = $/side/` : `AND side IN ('buy', 'sell')`}
          AND fillability_status = 'fillable'
          AND approval_status = 'approved'
        `;

        const orders = await ridb.manyOrNone(query, {
          maker: toBuffer(payload.maker),
          side: payload.side,
        });

        if (orders.length) {
          for (const order of orders) {
            await orderRevalidationsJob.addToQueue([
              { by: "id", data: { id: order.id, status: payload.status } },
            ]);
          }
        }
      }

      return { message: "Success" };
    } catch (error) {
      logger.error("post-revalidate-order-handler", `Handler failure: ${error}`);
      throw error;
    }
  },
};
