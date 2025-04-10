/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from "lodash";

import { fromBuffer, toBuffer } from "@/common/utils";
import { idb } from "@/common/db";
import { logger } from "@/common/logger";

import { ActivityDocument, ActivityType } from "@/elasticsearch/indexes/activities/base";
import { getActivityHash } from "@/elasticsearch/indexes/activities/utils";
import {
  BaseActivityEventHandler,
  TransactionInfo,
} from "@/elasticsearch/indexes/activities/event-handlers/base";
import { FtTransferEventCreatedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/ft-transfer-event-created";
import { config } from "@/config/index";

export class TransactionCreatedEventHandler extends BaseActivityEventHandler {
  public txHash: string;
  constructor(txHash: string) {
    super();

    this.txHash = txHash;
  }

  async generateActivity(): Promise<ActivityDocument | null> {
    const data = await idb.oneOrNone(
      `
                ${TransactionCreatedEventHandler.buildBaseQuery()}
                WHERE hash = $/txHash/
                LIMIT 1;  
                `,
      {
        txHash: toBuffer(this.txHash),
      }
    );

    if (!data) {
      logger.warn(
        "TransactionCreatedEventHandler",
        `failed to generate elastic activity. txHash=${this.txHash}`
      );

      return null;
    }

    return this.buildDocument(data);
  }

  getActivityType(): ActivityType {
    return ActivityType.contractCall;
  }

  getActivityId(): string {
    return getActivityHash(this.getActivityType(), this.txHash);
  }

  public static buildBaseQuery() {
    return `
        SELECT
            transactions."from",
            transactions."to",
            transactions."to" AS "contract",
            transactions."hash" AS "event_tx_hash",
            transactions."block_timestamp" AS "event_timestamp",
            transactions."block_hash" AS "event_block_hash",
            transactions."gas_price" AS "event_gas_price",
            transactions."value" AS "event_value",
            transactions."data" AS "event_data",
            extract(epoch from transactions.created_at) AS "created_ts",
            (
                SELECT
                    array_agg(
                            json_build_object(
                                    'from', concat('0x', encode(ft_transfer_events.from, 'hex')),
                                    'address', concat('0x', encode(ft_transfer_events.address, 'hex')),
                                    'amount', ft_transfer_events.amount,
                                    'log_index', ft_transfer_events.log_index
                            )
                    )
                FROM
                    ft_transfer_events
                WHERE ft_transfer_events.tx_hash = transactions.hash) AS "ft_transfer_events"
        FROM transactions
    `;
  }

  public buildDocument(data: any): ActivityDocument {
    const activityDocument = super.buildDocument(data);

    const callData = fromBuffer(data.event_data);
    const functionSelector = callData.slice(0, 10);

    if (data?.ft_transfer_events?.length) {
      try {
        if (
          functionSelector === "0xa9059cbb" &&
          data.ft_transfer_events[0].from === fromBuffer(data.from)
        ) {
          const ftTransferEventCreatedEventHandler = new FtTransferEventCreatedEventHandler(
            this.txHash,
            data.ft_transfer_events[0].log_index.toString()
          );

          activityDocument.parentId = ftTransferEventCreatedEventHandler.getActivityId();
        } else if (functionSelector === "0x") {
          const nativeErc20TrackerTransfer = data.ft_transfer_events.find(
            (ft_transfer_event: { address: string; from: string; amount: number }) =>
              ft_transfer_event.address === config.nativeErc20Tracker &&
              ft_transfer_event.from === fromBuffer(data.from) &&
              ft_transfer_event.amount == data.event_value
          );

          if (nativeErc20TrackerTransfer) {
            const ftTransferEventCreatedEventHandler = new FtTransferEventCreatedEventHandler(
              this.txHash,
              nativeErc20TrackerTransfer.log_index.toString()
            );

            activityDocument.parentId = ftTransferEventCreatedEventHandler.getActivityId();
          }
        }
      } catch (error) {
        logger.error(
          "transaction-event-created-event-handler",
          JSON.stringify({
            topic: "generate-activities",
            message: `Error parsing transfer. txHash=${activityDocument.event?.txHash}, error=${error}`,
            data,
            error,
          })
        );
      }
    }

    activityDocument.transaction = {
      gasPrice: String(data.event_gas_price),
      value: String(data.event_value),
      functionSelector,
    };

    return activityDocument;
  }

  parseEvent(data: any) {
    data.timestamp = data.event_timestamp;

    if (data.event_data) {
      const callData = fromBuffer(data.event_data);
      data.event_function_selector = callData.slice(0, 10);
    }
  }

  static async generateActivities(events: TransactionInfo[]): Promise<ActivityDocument[]> {
    const activities: ActivityDocument[] = [];

    const eventsFilter = [];

    for (const event of events) {
      eventsFilter.push(`('${_.replace(event.txHash, "0x", "\\x")}')`);
    }

    const results = await idb.manyOrNone(
      `
                ${TransactionCreatedEventHandler.buildBaseQuery()}
                WHERE (hash) IN ($/eventsFilter:raw/);  
                `,
      { eventsFilter: _.join(eventsFilter, ",") }
    );

    for (const result of results) {
      try {
        const eventHandler = new TransactionCreatedEventHandler(result.event_tx_hash);

        const activity = eventHandler.buildDocument(result);

        activities.push(activity);
      } catch (error) {
        logger.error(
          "transaction-event-created-event-handler",
          JSON.stringify({
            topic: "generate-activities",
            message: `Error build document. error=${error}`,
            result,
            error,
          })
        );
      }
    }

    return activities;
  }
}
