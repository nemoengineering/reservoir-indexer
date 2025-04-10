/* eslint-disable @typescript-eslint/no-explicit-any */ 3;

import { config } from "@/config/index";
import {
  BuildTokenDocumentData,
  TokenDocument,
  TokenDocumentBuilder,
} from "@/elasticsearch/indexes/tokens/base";

export abstract class BaseTokenEventHandler {
  public contract: string;
  public tokenId: string;

  constructor(contract: string, tokenId: string) {
    this.contract = contract;
    this.tokenId = tokenId;
  }

  getDocumentId(): string {
    return `${config.chainId}:${this.contract}:${this.tokenId}`;
  }

  public buildDocument(data: any): TokenDocument {
    const buildDocumentData = {
      id: this.getDocumentId(),
      created_at: new Date(data.created_at),
      contract: data.contract,
      token_id: data.token_id,
      name: data.name,
      supply: data.supply,
      remaining_supply: data.remaining_supply,
      attributes: data.attributes,
      collection_id: data.collection_id,
      collection_name: data.collection_name,
    } as BuildTokenDocumentData;

    return new TokenDocumentBuilder().buildDocument(buildDocumentData);
  }
}

export interface TokenDocumentInfo {
  id: string;
  document: TokenDocument;
}
