/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ActivityBuilder,
  ActivityDocument,
  ActivityType,
} from "@/elasticsearch/indexes/activities/base";

export abstract class BaseActivityEventHandler {
  abstract getActivityId(data: any): string;

  abstract getActivityType(data: any): ActivityType;

  abstract parseEvent(data: any): void;

  public buildDocument(data: any): ActivityDocument {
    this.parseEvent(data);

    data.id = this.getActivityId(data);
    data.type = this.getActivityType(data);

    return new ActivityBuilder().buildDocument(data);
  }
}

export interface RelayRequestProcessedInfo {
  id: string;
  status: string;
  user: string;
  recipient: string;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface SwapCreatedInfo {
  block: number;
  blockTimestamp: number;
  txHash: string;
  wallet: string;
  fromToken: string;
  fromAmount: string;
  toToken: string;
  toAmount: string;
}

export interface TransactionInfo {
  txHash: string;
}

export interface FtTransferEventInfo {
  txHash: string;
  logIndex: number;
}

export interface NftTransferEventInfo extends FtTransferEventInfo {
  batchIndex: number;
}

export interface OrderEventInfo {
  orderId: string;
  txHash?: string;
  logIndex?: number;
  batchIndex?: number;
}
