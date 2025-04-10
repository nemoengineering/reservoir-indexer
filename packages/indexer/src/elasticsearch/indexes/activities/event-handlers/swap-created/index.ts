/* eslint-disable @typescript-eslint/no-explicit-any */

import { bn, formatPrice, formatUsd, toBuffer } from "@/common/utils";

import { ActivityDocument, ActivityType } from "@/elasticsearch/indexes/activities/base";
import { getActivityHash } from "@/elasticsearch/indexes/activities/utils";
import {
  BaseActivityEventHandler,
  SwapCreatedInfo,
} from "@/elasticsearch/indexes/activities/event-handlers/base";
import { logger } from "@/common/logger";
import { getCurrency } from "@/utils/currencies";
import { idb } from "@/common/db";
import { config } from "@/config/index";
import * as Sdk from "@reservoir0x/sdk";

export class SwapCreatedEventHandler extends BaseActivityEventHandler {
  public block: number;
  public blockTimestamp: number;
  public txHash: string;
  public wallet: string;
  public fromToken: string;
  public fromAmount: string;
  public toToken: string;
  public toAmount: string;

  constructor(
    block: number,
    blockTimestamp: number,
    txHash: string,
    wallet: string,
    fromToken: string,
    fromAmount: string,
    toToken: string,
    toAmount: string
  ) {
    super();

    this.block = block;
    this.blockTimestamp = blockTimestamp;
    this.txHash = txHash;
    this.wallet = wallet;
    this.fromToken = fromToken;
    this.fromAmount = fromAmount;
    this.toToken = toToken;
    this.toAmount = toAmount;
  }

  async generateActivity(): Promise<ActivityDocument | null> {
    try {
      const data = {
        timestamp: this.blockTimestamp,
        event_tx_hash: toBuffer(this.txHash),
        event_timestamp: this.blockTimestamp,
        from: toBuffer(this.wallet),
        to: toBuffer(this.wallet),
      };

      const activityDocument = this.buildDocument(data);

      const currencyIn = await getCurrency(this.fromToken);
      let currencyInAmountUsd = "0";

      try {
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
            contract:
              this.fromToken === config.nativeErc20Tracker ||
              this.fromToken === Sdk.Common.Addresses.Native[config.chainId]
                ? toBuffer(Sdk.Common.Addresses.WNative[config.chainId])
                : toBuffer(this.fromToken),
            timestamp: this.blockTimestamp,
          }
        );

        if (currencyInResult?.value) {
          const currencyUnit = bn(10).pow(currencyIn.decimals ?? 18);
          const currencyAmountUsd = bn(this.fromAmount)
            .mul(currencyInResult.value)
            .div(currencyUnit);

          currencyInAmountUsd = formatUsd(currencyAmountUsd).toString();
        }
      } catch (error) {
        logger.error(
          "SwapCreatedEventHandler",
          JSON.stringify({
            message: `currencyIn Error. txHash=${this.txHash}, fromToken=${this.fromToken},error=${error}`,
            error,
          })
        );
      }

      const currencyOut = await getCurrency(this.toToken);
      let currencyOutAmountUsd = "0";

      try {
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
            contract:
              this.toToken === config.nativeErc20Tracker ||
              this.toToken === Sdk.Common.Addresses.Native[config.chainId]
                ? toBuffer(Sdk.Common.Addresses.WNative[config.chainId])
                : toBuffer(this.toToken),
            timestamp: this.blockTimestamp,
          }
        );

        if (currencyOutResult?.value) {
          const currencyUnit = bn(10).pow(currencyOut.decimals ?? 18);
          const currencyAmountUsd = bn(this.toAmount)
            .mul(currencyOutResult.value)
            .div(currencyUnit);

          currencyOutAmountUsd = formatUsd(currencyAmountUsd).toString();
        }
      } catch (error) {
        logger.error(
          "SwapCreatedEventHandler",
          JSON.stringify({
            message: `currencyOut Error. txHash=${this.txHash}, fromToken=${this.toToken},error=${error}`,
            error,
          })
        );
      }

      activityDocument.createdAt = new Date(this.blockTimestamp * 1000);
      activityDocument.fromCurrency = this.fromToken;
      activityDocument.toCurrency = this.toToken;

      activityDocument.swap = {
        fromCurrency: {
          chainId: config.chainId.toString(),
          txHash: this.txHash,
          currency: {
            contract: currencyIn?.contract ?? this.fromToken,
            name: currencyIn?.name,
            symbol: currencyIn?.symbol,
            decimals: currencyIn?.decimals,
            metadata: {
              image: currencyIn?.metadata?.image,
            },
          },
          amount: {
            raw: this.fromAmount,
            decimal: formatPrice(this.fromAmount, currencyIn?.decimals).toString(),
            usd: currencyInAmountUsd,
          },
        },
        toCurrency: {
          chainId: config.chainId.toString(),
          txHash: this.txHash,
          currency: {
            contract: this.toToken,
            name: currencyOut?.name,
            symbol: currencyOut?.symbol,
            decimals: currencyOut?.decimals,
            metadata: {
              image: currencyOut?.metadata?.image,
            },
          },
          amount: {
            raw: this.toAmount,
            decimal: formatPrice(this.toAmount, currencyOut?.decimals).toString(),
            usd: currencyOutAmountUsd,
          },
        },
      };

      return activityDocument;
    } catch (error) {
      logger.error(
        "SwapCreatedEventHandler",
        JSON.stringify({
          message: `Error. txHash=${this.txHash}, error=${error}`,
          error,
        })
      );

      return null;
    }
  }

  getActivityType(): ActivityType {
    return ActivityType.swap;
  }

  getActivityId(): string {
    return getActivityHash(this.getActivityType(), this.txHash);
  }

  parseEvent() {
    //  Do Nothing
  }

  static async generateActivities(events: SwapCreatedInfo[]): Promise<ActivityDocument[]> {
    const activities: ActivityDocument[] = [];

    for (const event of events) {
      const swapCreatedEventHandler = new SwapCreatedEventHandler(
        event.block,
        event.blockTimestamp,
        event.txHash,
        event.wallet,
        event.fromToken,
        event.fromAmount,
        event.toToken,
        event.toAmount
      );

      const activity = await swapCreatedEventHandler.generateActivity();

      if (activity) {
        activities.push(activity);
      }
    }

    return activities;
  }
}
