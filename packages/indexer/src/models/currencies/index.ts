import _ from "lodash";
import { idb } from "@/common/db";
import { toBuffer } from "@/common/utils";

export type CurrencyMetadata = {
  coingeckoCurrencyId?: string | null;
  image?: string | null;
  adminImage?: string | null;
  adminName?: string | null;
  erc20Incompatible?: boolean | null;
  description?: string | null;
  externalLink?: string | null;
  twitterUrl?: string | null;
  twitterUsername?: string | null;
  discordUrl?: string | null;
  telegramUrl?: string | null;
  redditUrl?: string | null;
  githubUrl?: string | null;
};

export class Currencies {
  public static async updateCurrency(contract: string, metadata: CurrencyMetadata) {
    const updateString = ["updated_at = NOW(),"];
    const replacementValues: { contract: Buffer; name?: string; metadata?: CurrencyMetadata } = {
      contract: toBuffer(contract),
    };
    if (metadata.adminName) {
      updateString.push("name = $/name/,");
      replacementValues.name = metadata.adminName;
    }

    const metadataFieldsToRemove: string[] = [];
    const metadataFields: { [key: string]: string | boolean } = {};

    _.forEach(metadata, (value, fieldName) => {
      if (_.isNull(value)) {
        metadataFieldsToRemove.push(fieldName);
      } else if (!_.isUndefined(value)) {
        metadataFields[fieldName] = value;
      }
    });

    if (!_.isEmpty(metadataFields)) {
      updateString.push(`metadata = COALESCE(currencies.metadata, '{}') || $/metadata:json/`);
      replacementValues.metadata = metadataFields;

      const query = `
        UPDATE currencies
        SET ${updateString.join(" ")}
        WHERE contract = $/contract/
      `;

      await idb.none(query, replacementValues);
      updateString.pop();
    }
    if (!_.isEmpty(metadataFieldsToRemove)) {
      updateString.push(
        `metadata = currencies.metadata - '${_.join(metadataFieldsToRemove, "' - '")}'`
      );
      const deleteQuery = `
        UPDATE currencies
        SET ${updateString.join(" ")}
        WHERE contract = $/contract/
      `;

      await idb.none(deleteQuery, replacementValues);
    }
  }
}
