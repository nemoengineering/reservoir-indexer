/* eslint-disable @typescript-eslint/no-explicit-any */

import { bn, formatUsd, toBuffer } from "@/common/utils";

import { ActivityDocument, ActivityType } from "@/elasticsearch/indexes/activities/base";
import { getActivityHash } from "@/elasticsearch/indexes/activities/utils";
import {
  BaseActivityEventHandler,
  RelayRequestProcessedInfo,
} from "@/elasticsearch/indexes/activities/event-handlers/base";
import { logger } from "@/common/logger";
import { getCurrency } from "@/utils/currencies";
import { idb } from "@/common/db";
import { config } from "@/config/index";

export class RelayRequestProcessedEventHandler extends BaseActivityEventHandler {
  public id: string;
  public status: string;
  public user: string;
  public recipient: string;
  public data: any;
  public createdAt: string;
  public updatedAt: string;
  constructor(
    id: string,
    status: string,
    user: string,
    recipient: string,
    data: any,
    createdAt: string,
    updatedAt: string
  ) {
    super();

    this.id = id;
    this.status = status;
    this.user = user;
    this.recipient = recipient;
    this.data = data;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
  async generateActivity(): Promise<ActivityDocument | null> {
    if (this.data.inTxs[0].chainId === this.data.outTxs[0].chainId) {
      return null;
    }

    try {
      let currencyIn;
      let currencyInAmountUsd = this.data.metadata.currencyIn.amountUsd;

      const currencyInAddress = this.data.metadata.currencyIn.currency.address.toLowerCase();

      if (currencyInAmountUsd === "0" && config.chainId === this.data.inTxs[0].chainId) {
        try {
          currencyIn = await getCurrency(currencyInAddress);

          const currencyInResult = await idb.oneOrNone(
            `
                SELECT
                    MIN(usd_prices_minutely."value") AS value 
                    FROM usd_prices_minutely
                    WHERE usd_prices_minutely.currency = $/contract/
                    AND extract(epoch from usd_prices_minutely."timestamp") >= ($/timestamp/ - 60)
                    AND extract(epoch from usd_prices_minutely."timestamp") < ($/timestamp/ + 60)
                    GROUP BY value, timestamp
                    ORDER BY "timestamp" DESC
                    LIMIT 1
                `,
            {
              contract: toBuffer(currencyInAddress),
              timestamp: this.data.inTxs[0].timestamp,
            }
          );

          if (currencyInResult?.value) {
            const currencyUnit = bn(10).pow(this.data.metadata.currencyIn.currency.decimals);
            const currencyAmountUsd = bn(this.data.metadata.currencyIn.amount)
              .mul(currencyInResult.value)
              .div(currencyUnit);

            currencyInAmountUsd = formatUsd(currencyAmountUsd).toString();
          }
        } catch (error) {
          logger.error(
            "RelayRequestProcessedEventHandler",
            JSON.stringify({
              message: `currencyIn Error. id=${this.id}, error=${error}`,
              data: JSON.stringify(this.data),
              error,
            })
          );
        }
      }

      let currencyOut;
      let currencyOutAmountUsd = this.data.metadata.currencyOut.amountUsd;

      const currencyOutAddress = this.data.metadata.currencyOut.currency.address.toLowerCase();

      if (currencyOutAmountUsd === "0" && config.chainId === this.data.outTxs[0].chainId) {
        try {
          currencyOut = await getCurrency(currencyOutAddress);

          const currencyOutResult = await idb.oneOrNone(
            `
                SELECT
                    MIN(usd_prices_minutely."value") AS value 
                    FROM usd_prices_minutely
                    WHERE usd_prices_minutely.currency = $/contract/
                    AND extract(epoch from usd_prices_minutely."timestamp") >= ($/timestamp/ - 60)
                    AND extract(epoch from usd_prices_minutely."timestamp") < ($/timestamp/ + 60)
                    GROUP BY value, timestamp
                    ORDER BY "timestamp" DESC
                    LIMIT 1
                `,
            {
              contract: toBuffer(currencyOutAddress),
              timestamp: this.data.outTxs[0].timestamp ?? this.data.inTxs[0].timestamp,
            }
          );

          if (currencyOutResult?.value) {
            const currencyUnit = bn(10).pow(this.data.metadata.currencyOut.currency.decimals);
            const currencyAmountUsd = bn(this.data.metadata.currencyOut.amount)
              .mul(currencyOutResult.value)
              .div(currencyUnit);

            currencyOutAmountUsd = formatUsd(currencyAmountUsd).toString();
          }
        } catch (error) {
          logger.error(
            "RelayRequestProcessedEventHandler",
            JSON.stringify({
              message: `currencyOut Error. id=${this.id}, error=${error}`,
              data: JSON.stringify(this.data),
              error,
            })
          );
        }
      }

      const data = {
        timestamp: Math.floor(new Date(this.createdAt).getTime() / 1000),
        event_tx_hash:
          this.data.inTxs[0].chainId === config.chainId
            ? toBuffer(this.data.inTxs[0].hash)
            : toBuffer(this.data.outTxs[0].hash),
        event_timestamp:
          this.data.inTxs[0].chainId === config.chainId
            ? this.data.inTxs[0].timestamp
            : this.data.outTxs[0].timestamp,
        from: toBuffer(this.user),
        to: toBuffer(this.recipient),
      };

      const activityDocument = this.buildDocument(data);

      activityDocument.createdAt = new Date(this.createdAt);
      activityDocument.fromCurrency =
        this.data.inTxs[0].chainId === config.chainId ? currencyInAddress : undefined;
      activityDocument.toCurrency =
        this.data.outTxs[0].chainId === config.chainId ? currencyOutAddress : undefined;

      activityDocument.swap = {
        fromCurrency: {
          chainId: this.data.inTxs[0].chainId.toString(),
          txHash: this.data.inTxs[0].hash,
          currency: {
            contract: currencyIn?.contract ?? currencyInAddress,
            name: currencyIn?.name ?? this.data.metadata.currencyIn.currency.name,
            symbol: currencyIn?.symbol ?? this.data.metadata.currencyIn.currency.symbol,
            decimals: currencyIn?.decimals ?? this.data.metadata.currencyIn.currency.decimals,
            metadata: {
              image:
                currencyIn?.metadata?.image ??
                this.data.metadata.currencyIn.currency.metadata?.logoURI,
            },
          },
          amount: {
            raw: this.data.metadata.currencyIn.amount,
            decimal: this.data.metadata.currencyIn.amountFormatted,
            usd: currencyInAmountUsd,
          },
        },
        toCurrency: {
          chainId: this.data.outTxs[0].chainId.toString(),
          txHash: this.data.outTxs[0].hash,
          currency: {
            contract: currencyOut?.contract ?? currencyOutAddress,
            name: currencyOut?.name ?? this.data.metadata.currencyOut.currency.name,
            symbol: currencyOut?.symbol ?? this.data.metadata.currencyOut.currency.symbol,
            decimals: currencyOut?.decimals ?? this.data.metadata.currencyOut.currency.decimals,
            metadata: {
              image:
                currencyOut?.metadata?.image ??
                this.data.metadata.currencyOut.currency.metadata?.logoURI,
            },
          },
          amount: {
            raw: this.data.metadata.currencyOut.amount,
            decimal: this.data.metadata.currencyOut.amountFormatted,
            usd: currencyOutAmountUsd,
          },
        },
      };

      return activityDocument;
    } catch (error) {
      logger.error(
        "RelayRequestProcessedEventHandler",
        JSON.stringify({
          message: `Error. id=${this.id}, error=${error}`,
          data: JSON.stringify(this.data),
          error,
        })
      );

      return null;
    }
  }

  getActivityType(): ActivityType {
    return this.data.metadata.currencyIn.currency.address ===
      this.data.metadata.currencyOut.currency.address
      ? ActivityType.bridge
      : ActivityType.swap;
  }

  getActivityId(): string {
    return getActivityHash(this.getActivityType(), this.id);
  }

  parseEvent() {
    //  Do Nothing
  }

  static async generateActivities(
    events: RelayRequestProcessedInfo[]
  ): Promise<ActivityDocument[]> {
    const activities: ActivityDocument[] = [];

    for (const event of events) {
      const relayRequestProcessedEventHandler = new RelayRequestProcessedEventHandler(
        event.id,
        event.status,
        event.user,
        event.recipient,
        event.data,
        event.createdAt,
        event.updatedAt
      );

      const activity = await relayRequestProcessedEventHandler.generateActivity();

      if (activity) {
        activities.push(activity);
      }
    }

    return activities;
  }
}
