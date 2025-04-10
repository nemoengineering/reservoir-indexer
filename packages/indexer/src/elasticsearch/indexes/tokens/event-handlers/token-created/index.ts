/* eslint-disable @typescript-eslint/no-explicit-any */

import { idb } from "@/common/db";
import _ from "lodash";
import { logger } from "@/common/logger";

import {
  BaseTokenEventHandler,
  TokenDocumentInfo,
} from "@/elasticsearch/indexes/tokens/event-handlers/base";
import { TokenEventInfo } from "@/elasticsearch/indexes/tokens/base";
import { fromBuffer, toBuffer } from "@/common/utils";

export class TokenCreatedEventHandler extends BaseTokenEventHandler {
  async generateToken(): Promise<TokenDocumentInfo | null> {
    const query = `
          ${TokenCreatedEventHandler.buildBaseQuery()}
          WHERE tokens.contract = $/contract/ AND tokens.token_id = $/tokenId/
          LIMIT 1;
        `;

    const data = await idb.oneOrNone(query, {
      contract: toBuffer(this.contract),
      tokenId: this.tokenId,
    });

    if (data) {
      return { id: this.getDocumentId(), document: this.buildDocument(data) };
    }

    return null;
  }

  public static buildBaseQuery() {
    return `
        SELECT
            tokens.token_id,
            tokens.contract,
            tokens.name,
            tokens.supply,
            tokens.remaining_supply,
            collections.id AS "collection_id", 
            collections.name AS "collection_name", 
            (
            SELECT 
              array_agg(
                json_build_object(
                  'key', ta.key, 'kind', attributes.kind, 
                  'value', ta.value
                )
              ) 
            FROM 
              token_attributes ta 
            JOIN attributes ON ta.attribute_id = attributes.id
            WHERE 
              ta.contract = tokens.contract
              AND ta.token_id = tokens.token_id
              AND ta.key != ''
          ) AS "attributes",
          extract(epoch from tokens.updated_at) "updated_ts" 
        FROM tokens
        JOIN collections on collections.id = tokens.collection_id
     `;
  }

  static async generateTokens(events: TokenEventInfo[]): Promise<TokenDocumentInfo[]> {
    const tokens: TokenDocumentInfo[] = [];

    const tokensFilter = [];

    for (const event of events) {
      tokensFilter.push(`('${_.replace(event.contract, "0x", "\\x")}', '${event.tokenId}')`);
    }

    const results = await idb.manyOrNone(
      `
                ${TokenCreatedEventHandler.buildBaseQuery()}
                WHERE (contract, token_id) IN ($/tokensFilter:raw/)';  
                `,
      { tokensFilter: _.join(tokensFilter, ",") }
    );

    for (const result of results) {
      const contract = fromBuffer(result.contract);
      const tokenId = result.token_id;

      try {
        const event = events.find(
          (event) => event.contract === contract && event.tokenId === tokenId
        );

        if (event) {
          const eventHandler = new TokenCreatedEventHandler(contract, tokenId);

          const id = eventHandler.getDocumentId();
          const document = eventHandler.buildDocument(result);

          tokens.push({ id, document });
        } else {
          logger.warn(
            "token-created-event-handler",
            JSON.stringify({
              topic: "generate-tokens",
              message: `Invalid token. contract=${contract}, contract=${tokenId}`,
              result,
            })
          );
        }
      } catch (error) {
        logger.error(
          "token-created-event-handler",
          JSON.stringify({
            topic: "generate-tokens",
            message: `Error build document. error=${error}`,
            result,
            error,
          })
        );
      }
    }

    return tokens;
  }
}
