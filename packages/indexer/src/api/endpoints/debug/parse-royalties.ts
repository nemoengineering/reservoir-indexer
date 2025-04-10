/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";

import { getFillEventsFromTx } from "@/events-sync/handlers/royalties/utils";
import { FillPostProcessJob } from "@/jobs/fill-updates/fill-post-process-job";

export const parseRoyaltiesOptions: RouteOptions = {
  description: "Event Parsing",
  tags: ["debug"],
  plugins: {
    "hapi-swagger": {
      order: 1,
    },
  },
  validate: {
    query: Joi.object({
      tx: Joi.string(),
      skipProcessing: Joi.boolean().default(true),
    }),
  },
  response: {},
  handler: async (request: Request) => {
    const query = request.query as any;
    try {
      const { fillEvents } = await getFillEventsFromTx(query.tx);
      const job = new FillPostProcessJob();
      await job.process({
        fillEvents,
        attempt: 1,
      });
      return {
        fillEvents,
      };
    } catch (error) {
      return { error };
    }
  },
};
