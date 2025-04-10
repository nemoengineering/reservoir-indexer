import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import { AllChainsChannel } from "@/pubsub/channels";
import { redb } from "@/common/db";
import { AllChainsPubSub } from "@/pubsub/index";
import _ from "lodash";
import { RateLimitRuleEntity } from "@/models/rate-limit-rules/rate-limit-rule-entity";

export type SyncRateLimitRulesJobPayload = {
  ruleId?: number;
  scope?: string;
};

export class SyncRateLimitRulesJob extends AbstractRabbitMqJobHandler {
  queueName = "sync-rate-limit-rules";
  maxRetries = 10;
  concurrency = 30;

  public async process(payload: SyncRateLimitRulesJobPayload) {
    const { ruleId, scope } = payload;
    const limit = 5000;
    const conditions: string[] = [];
    let rateLimitRuleValues;

    if (ruleId) {
      conditions.push("id = $/ruleId/");
    }

    do {
      rateLimitRuleValues = await redb.manyOrNone(
        `
        SELECT *
        FROM rate_limit_rules
        ${conditions.length ? `WHERE ` + conditions.map((c) => `(${c})`).join(" AND ") : ""}
        ORDER BY id ASC
        LIMIT $/limit/
      `,
        {
          ruleId: ruleId,
          limit,
        }
      );

      if (rateLimitRuleValues) {
        for (const rateLimitRuleValue of rateLimitRuleValues) {
          const rateLimitRuleEntity = new RateLimitRuleEntity(rateLimitRuleValue);

          await AllChainsPubSub.publish(
            AllChainsChannel.RateLimitRuleCreated,
            JSON.stringify({ rule: rateLimitRuleEntity, scope })
          );
        }

        conditions.push(`id > '${_.last(rateLimitRuleValues).id}'`);
      }
    } while (rateLimitRuleValues.length === limit);
  }

  public async addToQueue(info: SyncRateLimitRulesJobPayload, delay = 0) {
    await this.send({ payload: info }, delay);
  }
}

export const syncRateLimitRulesJob = new SyncRateLimitRulesJob();
