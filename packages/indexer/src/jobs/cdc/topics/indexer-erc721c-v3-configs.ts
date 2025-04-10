/* eslint-disable @typescript-eslint/no-explicit-any */
import { KafkaEventHandler } from "./KafkaEventHandler";
import { collectionSecurityConfigUpdatedJob } from "@/jobs/collections/collection-security-config-updated";

export class IndexerErc721cV3ConfigsHandler extends KafkaEventHandler {
  topicName = "indexer.public.erc721c_v3_configs";

  protected async handleInsert(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    await collectionSecurityConfigUpdatedJob.addToQueue([
      {
        by: "contract",
        data: {
          contract: payload.after.contract,
        },
        context: `${this.topicName}_handleInsert`,
      },
    ]);
  }

  protected async handleUpdate(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    const changed = [];

    for (const key in payload.after) {
      const beforeValue = payload.before[key];
      const afterValue = payload.after[key];

      if (beforeValue !== afterValue) {
        changed.push(key);
      }
    }

    if (
      changed.some((value) =>
        ["transfer_validator", "transfer_security_level", "list_id"].includes(value)
      )
    ) {
      await collectionSecurityConfigUpdatedJob.addToQueue([
        {
          by: "contract",
          data: {
            contract: payload.after.contract,
          },
          context: `${this.topicName}_handleUpdate`,
        },
      ]);
    }
  }

  protected async handleDelete(): Promise<void> {
    // probably do nothing here
  }
}
