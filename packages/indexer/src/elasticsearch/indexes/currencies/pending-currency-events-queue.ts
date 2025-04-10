/* eslint-disable @typescript-eslint/no-explicit-any */

import _ from "lodash";
import { redis } from "@/common/redis";

import { CurrencyDocument } from "@/elasticsearch/indexes/currencies/base";

export type CurrencyEvent = {
  kind: "index" | "delete";
  info: {
    id: string;
    document?: Partial<CurrencyDocument>;
  };
};
export class PendingCurrencyEventsQueue {
  public key = "pending-currency-events-queue";

  public constructor(indexName?: string) {
    this.key += indexName ? `:${indexName}` : "";
  }

  public async add(events: CurrencyEvent[]) {
    if (_.isEmpty(events)) {
      return;
    }

    return redis.rpush(
      this.key,
      _.map(events, (event) => JSON.stringify(event))
    );
  }

  public async get(count = 500): Promise<CurrencyEvent[]> {
    const events = await redis.lpop(this.key, count);

    if (events) {
      return _.map(events, (event) => JSON.parse(event) as CurrencyEvent);
    }

    return [];
  }

  public async count(): Promise<number> {
    return await redis.llen(this.key);
  }
}
