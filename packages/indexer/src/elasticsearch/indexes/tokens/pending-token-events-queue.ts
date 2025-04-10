/* eslint-disable @typescript-eslint/no-explicit-any */

import _ from "lodash";
import { redis } from "@/common/redis";

import { TokenDocument } from "@/elasticsearch/indexes/tokens/base";

export type TokenEvent = {
  kind: "index" | "delete";
  info: {
    id: string;
    document?: TokenDocument;
  };
};

export class PendingTokenEventsQueue {
  public key = "pending-token-events-queue";

  public constructor(indexName?: string) {
    this.key += indexName ? `:${indexName}` : "";
  }

  public async add(events: TokenEvent[]) {
    if (_.isEmpty(events)) {
      return;
    }

    return redis.rpush(
      this.key,
      _.map(events, (event) => JSON.stringify(event))
    );
  }

  public async get(count = 500): Promise<TokenEvent[]> {
    const events = await redis.lpop(this.key, count);

    if (events) {
      return _.map(events, (event) => JSON.parse(event) as TokenEvent);
    }

    return [];
  }

  public async count(): Promise<number> {
    return await redis.llen(this.key);
  }
}
