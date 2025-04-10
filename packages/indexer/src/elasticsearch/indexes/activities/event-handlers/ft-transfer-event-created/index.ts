/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from "lodash";

import { bn, fromBuffer, toBuffer } from "@/common/utils";
import { idb } from "@/common/db";
import { logger } from "@/common/logger";

import { ActivityDocument, ActivityType } from "@/elasticsearch/indexes/activities/base";
import { getActivityHash } from "@/elasticsearch/indexes/activities/utils";
import {
  BaseActivityEventHandler,
  FtTransferEventInfo,
} from "@/elasticsearch/indexes/activities/event-handlers/base";
import { config } from "@/config/index";
import * as Sdk from "@reservoir0x/sdk";

export class FtTransferEventCreatedEventHandler extends BaseActivityEventHandler {
  public txHash: string;
  public logIndex: number;

  constructor(txHash: string, logIndex: number) {
    super();

    this.txHash = txHash;
    this.logIndex = logIndex;
  }

  async generateActivity(): Promise<ActivityDocument | null> {
    const data = await idb.oneOrNone(
      `
                ${FtTransferEventCreatedEventHandler.buildBaseQuery()}
                WHERE tx_hash = $/txHash/
                AND log_index = $/logIndex/
                LIMIT 1;  
                `,
      {
        txHash: toBuffer(this.txHash),
        logIndex: this.logIndex.toString(),
        nativeErc20TrackerAddress: config.nativeErc20Tracker
          ? toBuffer(config.nativeErc20Tracker)
          : undefined,
        wethAddress: toBuffer(Sdk.Common.Addresses.WNative[config.chainId]),
      }
    );

    if (!data) {
      logger.warn(
        "NftTransferEventCreatedEventHandler",
        `failed to generate elastic activity activity. txHash=${this.txHash}, logIndex=${this.logIndex}`
      );

      return null;
    }

    return this.buildDocument(data);
  }

  getActivityType(): ActivityType {
    return ActivityType.tokenTransfer;
  }

  getActivityId(): string {
    return getActivityHash(this.getActivityType(), this.txHash, this.logIndex.toString());
  }

  public static buildBaseQuery() {
    let currencyAddressQueryPart = "ft_transfer_events.address";

    if (config.nativeErc20Tracker) {
      currencyAddressQueryPart = `CASE WHEN ft_transfer_events.address = $/nativeErc20TrackerAddress/ THEN $/wethAddress/ ELSE ft_transfer_events.address END`;
    }

    return `
                SELECT
                  address AS "contract",
                  "from",
                  "to",
                  amount,
                  c.decimals AS "currency_decimals",
                  upm.value AS "currency_usd_value",
                  address AS "pricing_currency",
                  amount AS "pricing_price",
                  c.decimals AS "pricing_currency_decimals",
                  upm.value AS "pricing_currency_usd_value",
                  tx_hash AS "event_tx_hash",
                  timestamp AS "event_timestamp",
                  block_hash AS "event_block_hash",
                  log_index AS "event_log_index",
                  extract(epoch from created_at) AS "created_ts",
                  extract(epoch from updated_at) AS "updated_ts"
                FROM ft_transfer_events
                LEFT JOIN LATERAL (
                    SELECT
                    currencies.decimals
                    FROM currencies
                    WHERE currencies.contract = ${currencyAddressQueryPart}
                    LIMIT 1
                ) c ON TRUE
                LEFT JOIN LATERAL (
                    SELECT
                    MIN(usd_prices_minutely."value") AS value 
                    FROM usd_prices_minutely
                    WHERE usd_prices_minutely.currency = ${currencyAddressQueryPart}
                    AND extract(epoch from usd_prices_minutely."timestamp") >= (ft_transfer_events."timestamp" - 60)
                    AND extract(epoch from usd_prices_minutely."timestamp") < (ft_transfer_events."timestamp" + 60)
                    GROUP BY value, timestamp
                    ORDER BY "timestamp" DESC
                    LIMIT 1
                ) upm ON TRUE
                 `;
  }

  public buildDocument(data: any): ActivityDocument {
    const activityDocument = super.buildDocument(data);

    if (data.pricing_currency_usd_value) {
      const currencyUnit = bn(10).pow(data.pricing_currency_decimals);

      activityDocument.ftTransferEvent = {
        amountUsd: bn(data.amount)
          .mul(data.pricing_currency_usd_value)
          .div(currencyUnit)
          .toString(),
      };
    }

    return activityDocument;
  }

  parseEvent(data: any) {
    data.timestamp = data.event_timestamp;
    data.from_currency = fromBuffer(data.contract);

    if (data.pricing_currency_usd_value) {
      const currencyUnit = bn(10).pow(data.pricing_currency_decimals);

      data.pricing_usd_price = bn(data.pricing_price)
        .mul(data.pricing_currency_usd_value)
        .div(currencyUnit)
        .toString();
    }
  }

  static async generateActivities(events: FtTransferEventInfo[]): Promise<ActivityDocument[]> {
    const activities: ActivityDocument[] = [];

    const eventsFilter = [];

    for (const event of events) {
      eventsFilter.push(`('${_.replace(event.txHash, "0x", "\\x")}', '${event.logIndex}')`);
    }

    const results = await idb.manyOrNone(
      `
                ${FtTransferEventCreatedEventHandler.buildBaseQuery()}
                WHERE (tx_hash,log_index) IN ($/eventsFilter:raw/);  
                `,
      {
        eventsFilter: _.join(eventsFilter, ","),
        nativeErc20TrackerAddress: config.nativeErc20Tracker
          ? toBuffer(config.nativeErc20Tracker)
          : undefined,
        wethAddress: toBuffer(Sdk.Common.Addresses.WNative[config.chainId]),
      }
    );

    for (const result of results) {
      try {
        const eventHandler = new FtTransferEventCreatedEventHandler(
          result.event_tx_hash,
          result.event_log_index
        );

        const activity = eventHandler.buildDocument(result);

        activities.push(activity);
      } catch (error) {
        logger.error(
          "ft-transfer-event-created-event-handler",
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
