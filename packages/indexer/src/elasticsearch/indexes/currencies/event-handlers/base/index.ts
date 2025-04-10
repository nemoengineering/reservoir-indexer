/* eslint-disable @typescript-eslint/no-explicit-any */
import { config } from "@/config/index";

import {
  BuildCurrencyDocumentData,
  CurrencyDocument,
  CurrencyDocumentBuilder,
} from "@/elasticsearch/indexes/currencies/base";

export abstract class BaseCurrencyEventHandler {
  public contract: string;

  constructor(contract: string) {
    this.contract = contract;
  }

  getDocumentId(): string {
    return `${config.chainId}:${this.contract}`;
  }

  public async buildDocument(data: any): Promise<CurrencyDocument> {
    const buildDocumentData = {
      id: this.getDocumentId(),
      created_at: new Date(data.created_at),
      contract: data.contract,
      name: data.name,
      symbol: data.symbol,
      decimals: data.decimals,
      total_supply: data.total_supply,
      metadata_image: data.metadata_image,
      all_time_volume: data.all_time_volume,
    } as BuildCurrencyDocumentData;

    return new CurrencyDocumentBuilder().buildDocument(buildDocumentData);
  }
}

export interface CurrencyDocumentInfo {
  id: string;
  document: CurrencyDocument;
}
