/* eslint-disable @typescript-eslint/no-explicit-any */

import { fromBuffer } from "@/common/utils";
import { config } from "@/config/index";

import { BuildDocumentData, BaseDocument, DocumentBuilder } from "@/elasticsearch/indexes/base";
import { getChainName } from "@/config/network";
import _ from "lodash";

export interface TokenDocument extends BaseDocument {
  id: string;
  name: string;
  attributes: any;
  supply: number;
  remainingSupply: number;
  hasRemainingSupply: boolean;
  collection?: {
    id: string;
    name: string;
  };
}

export interface BuildTokenDocumentData extends BuildDocumentData {
  id: string;
  created_at: Date;
  contract: Buffer;
  token_id: string;
  name?: string;
  attributes?: {
    key: string;
    value: string;
  }[];
  supply: number;
  remaining_supply: number;
  collection_id?: string;
  collection_name?: string;
}

export class TokenDocumentBuilder extends DocumentBuilder {
  public buildDocument(data: BuildTokenDocumentData): TokenDocument {
    const baseDocument = super.buildDocument(data);

    const attributes: any = {};

    if (data.attributes?.length) {
      for (const tokenAttribute of data.attributes) {
        attributes[tokenAttribute["key"]] = tokenAttribute["value"];
      }
    }

    return {
      ...baseDocument,
      chain: {
        id: config.chainId,
        name: getChainName(),
      },
      createdAt: data.created_at,
      contractAndTokenId: `${fromBuffer(data.contract)}:${data.token_id}`,
      contract: fromBuffer(data.contract),
      tokenId: data.token_id,
      name: data.name,
      supply: !_.isNull(data.supply) ? Number(data.supply) : null,
      remainingSupply: !_.isNull(data.remaining_supply) ? Number(data.remaining_supply) : null,
      hasRemainingSupply: _.isNull(data.remaining_supply)
        ? true
        : Number(data.remaining_supply) > 0,
      attributes,
      collection: data.collection_id
        ? {
            id: data.collection_id,
            name: data.collection_name,
          }
        : undefined,
    } as TokenDocument;
  }
}

export interface TokenEventInfo {
  contract: string;
  tokenId: string;
}
