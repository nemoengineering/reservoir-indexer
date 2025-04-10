/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb } from "@/common/db";

import { toBuffer } from "@/common/utils";
import {
  BaseCurrencyEventHandler,
  CurrencyDocumentInfo,
} from "@/elasticsearch/indexes/currencies/event-handlers/base";

export class CurrencyCreatedEventHandler extends BaseCurrencyEventHandler {
  async generateCurrency(): Promise<CurrencyDocumentInfo | null> {
    const query = `
          ${CurrencyCreatedEventHandler.buildBaseQuery()}
          WHERE currencies.contract = $/contract/ 
          LIMIT 1;
        `;

    const data = await idb.oneOrNone(query, {
      contract: toBuffer(this.contract),
    });

    if (data) {
      return { id: this.getDocumentId(), document: await this.buildDocument(data) };
    }

    return null;
  }

  public static buildBaseQuery() {
    return `
            SELECT        
              currencies.contract,
              currencies.name,
              currencies.symbol,
              currencies.decimals,
              currencies.total_supply,
              (currencies.metadata ->> 'image')::TEXT AS "metadata_image",
              currencies.all_time_volume,
              currencies.created_at,
              extract(epoch from currencies.updated_at) AS updated_ts
            FROM currencies
     `;
  }
}
