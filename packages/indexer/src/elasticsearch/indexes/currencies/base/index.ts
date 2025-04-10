/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";
import { logger } from "@/common/logger";

import { formatEth, fromBuffer } from "@/common/utils";

import { BuildDocumentData, BaseDocument } from "@/elasticsearch/indexes/base";
import { getUsdPrice } from "@/elasticsearch/indexes/utils";

export interface CurrencyDocument extends BaseDocument {
  id: string;
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  metadata?: {
    image?: string;
  };
  allTimeVolume?: string;
  allTimeVolumeDecimal?: number | null;
  allTimeVolumeUsd?: number;
}

export interface BuildCurrencyDocumentData extends BuildDocumentData {
  id: string;
  contract: Buffer;
  name: string;
  symbol: string;
  decimals: number;
  total_supply: number;
  metadata_image: string;
  created_at: Date;
  all_time_volume: string;
}

export class CurrencyDocumentBuilder {
  public async buildDocument(data: BuildCurrencyDocumentData): Promise<CurrencyDocument> {
    try {
      const allTimeVolumeUsd = await getUsdPrice(data.all_time_volume);
      const allTimeVolumeDecimal = data.all_time_volume ? formatEth(data.all_time_volume) : 0;

      const document = {
        chainId: String(config.chainId),
        id: data.id,
        indexedAt: new Date(),
        createdAt: data.created_at,
        contract: fromBuffer(data.contract),
        name: data.name?.trim(),
        symbol: data.symbol,
        decimals: data.decimals,
        totalSupply: data.total_supply != null ? String(data.total_supply) : null,
        suggest: this.getSuggest(data),
        metadata: {
          image: data.metadata_image,
        },
        allTimeVolume: data.all_time_volume,
        allTimeVolumeDecimal: allTimeVolumeDecimal,
        allTimeVolumeUsd: allTimeVolumeUsd,
      } as CurrencyDocument;

      return document;
    } catch (error) {
      logger.error(
        "CurrencyDocumentBuilder",
        JSON.stringify({
          message: `buildDocument Error. currency=${data.id}, error=${error}`,
          data,
          error,
        })
      );

      throw error;
    }
  }

  getSuggest(data: BuildCurrencyDocumentData): any {
    const suggest = [];

    const allTimeVolumeDecimal = data.all_time_volume ? formatEth(data.all_time_volume) : 0;

    function normalize(volume: number) {
      // Change of base formula for log base 10
      const log10 = (x: number) => Math.log(x) / Math.log(10);
      const result = 1 / (1 + Math.exp(-log10(1 + volume)));

      return result;
    }

    const normalizedVolume = normalize(allTimeVolumeDecimal) * 0.04;

    const weight = Math.ceil(normalizedVolume * 1000000000);

    if (data.name) {
      suggest.push({
        input: this.generateInputValues(data.name),
        weight,
        contexts: {
          chainId: [`${config.chainId}`],
        },
      });
    }

    if (data.symbol) {
      suggest.push({
        input: [data.symbol],
        weight,
        contexts: {
          chainId: [`${config.chainId}`],
        },
      });
    }

    return suggest;
  }

  generateInputValues(text: string): string[] {
    const words = text.trim().split(" ");
    const combinations: string[] = [];

    for (let i = 0; i < words.length; i++) {
      const combination = words.slice(i).join(" ");
      combinations.push(combination);
    }

    return combinations;
  }
}
