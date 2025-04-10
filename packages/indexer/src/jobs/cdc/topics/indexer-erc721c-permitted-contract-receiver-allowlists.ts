/* eslint-disable @typescript-eslint/no-explicit-any */
import { KafkaEventHandler } from "./KafkaEventHandler";
import { collectionSecurityConfigUpdatedJob } from "@/jobs/collections/collection-security-config-updated";

export class IndexerErc721cPermittedContractReceiverAllowlistsHandler extends KafkaEventHandler {
  topicName = "indexer.public.erc721c_permitted_contract_receiver_allowlists";

  protected async handleInsert(payload: any): Promise<void> {
    if (!payload.after) {
      return;
    }

    await collectionSecurityConfigUpdatedJob.addToQueue([
      {
        by: "transferValidator",
        data: {
          version: "v1",
          transferValidator: payload.after.transfer_validator,
          id: payload.after.id,
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

    if (changed.some((value) => ["allowlist"].includes(value))) {
      await collectionSecurityConfigUpdatedJob.addToQueue([
        {
          by: "transferValidator",
          data: {
            version: "v1",
            transferValidator: payload.after.transfer_validator,
            id: payload.after.id,
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
