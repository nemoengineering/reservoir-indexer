/* eslint-disable @typescript-eslint/no-explicit-any */

import { config } from "@/config/index";
import axios from "axios";
import _ from "lodash";
import { logger } from "@/common/logger";
import { USD_DECIMALS } from "@/utils/prices";
import {
  IGetHistoricalData,
  IGetSearchTokens,
  IGetToken24HourVolumeData,
  IGetTokensVolumesByDateResponse,
  IGetTokensWithPricingData,
  IGetTopTokens,
  IGetUsdPrice,
  ISubGraphError,
  ISubGraphMethod,
} from "../types";
import { UNISWAP_V3_QUERY } from "./queries";
import { BigNumber } from "@ethersproject/bignumber";
import { parseUnits } from "@ethersproject/units";
import { bn } from "@/common/utils";

export class UniswapSubgraphClassV3 implements ISubGraphMethod {
  public subgraphUrl = `https://gateway.thegraph.com/api/${config.uniswapSubgraphV3ApiKey}/subgraphs/id/${config.uniswapSubgraphV3Id}`;

  public getUrl(): string {
    // If we have URL use that
    if (config.uniswapSubgraphV3Url) {
      return config.uniswapSubgraphV3Url;
    }

    // Otherwise use remote subgraph
    return this.subgraphUrl;
  }

  /* eslint-disable  @typescript-eslint/no-explicit-any */
  async getGraphResponse(query: string, method: string) {
    const url = this.getUrl();
    try {
      const result = await axios.post(url, { query });
      const {
        data: { data, errors },
        status,
      } = result;
      if (errors) {
        const msg = [] as string[];
        errors.map((err: ISubGraphError) => msg.push(err.message));
        logger.error("UniswapSubgraphV3", `${status} - ${msg.join(",")}`);
      }
      return data;
    } catch (e: any) {
      logger.error(
        "UniswapSubgraphV3",
        JSON.stringify({
          message: `${method} error. error=${e.message}`,
          query,
          e,
        })
      );
      throw e("Unable to get tokens pricing data.");
    }
  }

  public async getUsdPrice(tokens: string[]): Promise<IGetUsdPrice> {
    const response: IGetUsdPrice = {};

    const query = UNISWAP_V3_QUERY.getUsdPrice(tokens);

    const data = await this.getGraphResponse(query, "getUsdPrice");

    // Set default response values
    for (const token of tokens) {
      response[token] = null;
    }

    // If we got info from the subgraph
    if (data?.tokens.length) {
      for (const token of tokens) {
        for (const subgraphToken of data.tokens) {
          if (
            subgraphToken.tokenDayData.length &&
            subgraphToken.tokenDayData[0].token.id === token
          ) {
            response[token] = {
              priceUSD: _.round(subgraphToken.tokenDayData[0].priceUSD, USD_DECIMALS),
              oneDayChange:
                subgraphToken.tokenDayData.length > 1 && Number(subgraphToken.tokenDayData[1].high)
                  ? _.round(
                      Number(subgraphToken.tokenDayData[0].priceUSD) /
                        Number(subgraphToken.tokenDayData[1].high),
                      6
                    )
                  : null,
            };
          }
        }
      }
    }

    return response;
  }

  public async getHistoricPrice(
    tokens: string[],
    granularity: "day" | "hour",
    periodInDays: number
  ): Promise<IGetHistoricalData> {
    const response: IGetHistoricalData = {};

    if (granularity === "day") {
      const query = UNISWAP_V3_QUERY.getHistoricPriceDay(tokens, periodInDays);

      const data = await this.getGraphResponse(query, "getHistoricPrice - day");

      // If we got info from the subgraph
      if (data.tokens.length) {
        for (const tokenData of data.tokens) {
          response[tokenData.id] = _.map(tokenData.tokenDayData, (priceData) => ({
            startTimestamp: priceData.date,
            endTimestamp: priceData.date + (60 * 60 * 24 - 1),
            high: priceData.high,
            low: priceData.low,
            open: priceData.open,
            close: priceData.close,
            priceUSD: _.round(priceData.priceUSD, USD_DECIMALS),
            volumeUSD: _.round(priceData.volumeUSD, USD_DECIMALS),
            volume: priceData.volume,
            decimals: Number(tokenData.decimals),
          }));
        }
      }
    } else if (granularity === "hour") {
      const fetchPricesPromises = [];

      for (const token of tokens) {
        const query = UNISWAP_V3_QUERY.getHistoricPriceHour(token, periodInDays * 24);

        fetchPricesPromises.push(axios.post(this.getUrl(), { query }));
      }

      const promisesResult = await Promise.all(fetchPricesPromises);
      if (promisesResult.length) {
        for (const result of promisesResult) {
          const {
            data: { data },
          } = result;

          if (data.tokenHourDatas.length) {
            response[data.tokenHourDatas[0].token.id] = _.map(data.tokenHourDatas, (priceData) => ({
              startTimestamp: priceData.periodStartUnix,
              endTimestamp: priceData.periodStartUnix + (60 * 60 - 1),
              high: priceData.high,
              low: priceData.low,
              open: priceData.open,
              close: priceData.close,
              priceUSD: _.round(priceData.priceUSD, USD_DECIMALS),
              volumeUSD: _.round(priceData.volumeUSD, USD_DECIMALS),
              volume: priceData.volume,
              decimals: Number(data.tokenHourDatas[0].token.decimals),
            }));
          }
        }
      }
    }

    return response;
  }

  public async getTokensWithPricingData(
    contracts: string[],
    realtimePriceOnly = false
  ): Promise<IGetTokensWithPricingData[]> {
    const tokens: IGetTokensWithPricingData[] = [];

    const limit = realtimePriceOnly ? 1 : 2;
    const query = UNISWAP_V3_QUERY.getTokensWithPricingData(contracts, limit);

    const data = await this.getGraphResponse(query, "getTokensWithPricingData");

    for (const token of data.tokens) {
      if (!token.tokenDayData.length) {
        continue;
      }

      const tokenData = token.tokenDayData[0];

      tokens.push({
        contract: String(tokenData.token.id),
        name: tokenData.token.name,
        symbol: tokenData.token.symbol,
        decimals: tokenData.token.decimals,
        totalSupply: tokenData.token.totalSupply,
        oneDayVolume: tokenData.volume,
        oneDayVolumeUSD: _.round(tokenData.volumeUSD, USD_DECIMALS),
        allTimeVolume: tokenData.token.volume,
        allTimeVolumeUSD: _.round(tokenData.token.volumeUSD, USD_DECIMALS),
        priceUSD: _.round(tokenData.priceUSD, USD_DECIMALS),
        oneDayChange: realtimePriceOnly
          ? null
          : token.tokenDayData.length > 1 &&
            token.tokenDayData[1].high &&
            Number(token.tokenDayData[1].high)
          ? _.round(Number(tokenData.priceUSD) / Number(token.tokenDayData[1].high), 6)
          : null,
      });
    }

    return tokens;
  }

  public async getTopTokensWithPricingData(limit = 100): Promise<IGetTokensWithPricingData[]> {
    const tokens: IGetTokensWithPricingData[] = [];

    const dayBeginning = new Date();

    dayBeginning.setUTCHours(0, 0, 0, 0);

    const dayBeginningTimestamp = Math.floor(dayBeginning.getTime() / 1000);

    const query = UNISWAP_V3_QUERY.getTopTokensWithPricingData(limit, dayBeginningTimestamp);

    const data = await this.getGraphResponse(query, "getTopTokensWithPricingData");

    for (const tokenDayData of data.tokenDayDatas) {
      const token = tokenDayData.token;

      const _tokenDayData = token.tokenDayData[0];

      tokens.push({
        contract: String(token.id),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply,
        oneDayVolume: _tokenDayData.volume,
        oneDayVolumeUSD: _.round(_tokenDayData.volumeUSD, USD_DECIMALS),
        allTimeVolume: token.volume,
        allTimeVolumeUSD: _.round(token.volumeUSD, USD_DECIMALS),
        priceUSD: _.round(_tokenDayData.priceUSD, USD_DECIMALS),
        oneDayChange:
          token.tokenDayData.length > 1 &&
          token.tokenDayData[1].high &&
          Number(token.tokenDayData[1].high)
            ? _.round(Number(_tokenDayData.priceUSD) / Number(token.tokenDayData[1].high), 6)
            : null,
      });
    }

    return tokens;
  }

  public async getTokensVolumesByDate(
    contracts: string[],
    date: number
  ): Promise<IGetTokensVolumesByDateResponse[]> {
    const tokens: IGetTokensVolumesByDateResponse[] = [];

    const query = UNISWAP_V3_QUERY.getTokensVolumesByDate(contracts, date);

    const data = await this.getGraphResponse(query, "getTokensVolumesByDate");

    for (const token of data.tokens) {
      tokens.push({
        contract: String(token.id),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply,
        date,
        dayVolume: token.tokenDayData.length
          ? parseUnits(token.tokenDayData[0].volume, token.decimals).toString()
          : "0",
        dayVolumeUSD: token.tokenDayData.length
          ? _.round(token.tokenDayData[0].volumeUSD, USD_DECIMALS)
          : 0,
        allTimeVolume: parseUnits(token.volume, token.decimals).toString(),
        allTimeVolumeUSD: _.round(token.volumeUSD, USD_DECIMALS),
      });
    }

    return tokens;
  }

  public async getTokens24HourVolume(
    contracts: string[],
    fromTimestamp: number,
    toTimestamp?: number
  ): Promise<IGetToken24HourVolumeData[]> {
    const data: IGetToken24HourVolumeData[] = [];

    // Chunk tokens to batch of 40 as this is the max tokens we can fetch 24 hour info (max limit 1000, and we need 24 hours data)
    const tokenHourDatas = (
      await Promise.all(
        _.chunk(contracts, 40).map(async (contractsChunk) => {
          const query = UNISWAP_V3_QUERY.getTokens24HourVolume(
            contractsChunk,
            fromTimestamp,
            toTimestamp
          );
          const subgraphResponseData = await this.getGraphResponse(query, "getTokens24HourVolume");

          logger.info(
            "UniswapSubgraphClassV3",
            JSON.stringify({
              topic: "updateTokens24HourVolume",
              message: `getGraphResponseV3. contracts=${contracts.length}, fromTimestamp=${fromTimestamp}, contractsChunk=${contractsChunk.length}`,
              contractsChunk,
              query,
              subgraphResponseData,
            })
          );

          return subgraphResponseData?.tokenHourDatas;
        })
      )
    ).flat();

    if (tokenHourDatas?.length) {
      for (const contract of contracts) {
        const tokenHourData: {
          token: { id: string; decimals: string };
          volume: string;
          volumeUSD: string;
        }[] = tokenHourDatas.filter(
          (tokenHourData: { token: { id: string; decimals: string } }) =>
            tokenHourData.token.id === contract
        );

        if (tokenHourData.length) {
          const volume = tokenHourData.reduce(
            (accumulator: BigNumber, tokenHourData) =>
              accumulator.add(parseUnits(tokenHourData.volume, tokenHourData.token.decimals)),
            bn(0)
          );

          const volumeUSD = tokenHourData.reduce(
            (accumulator: BigNumber, tokenHourData) =>
              accumulator.add(
                parseUnits(_.round(Number(tokenHourData.volumeUSD)).toString(), USD_DECIMALS)
              ),
            bn(0)
          );

          data.push({
            contract,
            volume: volume.toString(),
            volumeUSD: volumeUSD.toString(),
          });
        }
      }
    }

    return data;
  }

  public async searchTokens(prefix: string, limit = 20): Promise<IGetSearchTokens[]> {
    const tokens: IGetSearchTokens[] = [];

    const query = UNISWAP_V3_QUERY.searchTokens(prefix, limit);

    const data = await this.getGraphResponse(query, "searchTokens");

    for (const token of data.tokens) {
      tokens.push({
        contract: token.id,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      });
    }

    return tokens;
  }

  public async getTopTokens(count = 500, dayBeginningTimestamp = 0): Promise<IGetTopTokens[]> {
    const response: IGetTopTokens[] = [];

    if (!dayBeginningTimestamp) {
      const dayBeginning = new Date();
      dayBeginning.setUTCHours(0, 0, 0, 0);
      dayBeginningTimestamp = Math.floor(dayBeginning.getTime() / 1000);
    }

    const query = UNISWAP_V3_QUERY.getTopTokens(count, dayBeginningTimestamp);

    const data = await this.getGraphResponse(query, "getTopTokens");

    // If we got info from the subgraph
    if (data.tokenDayDatas.length) {
      for (const tokenDayData of data.tokenDayDatas) {
        response.push({
          id: tokenDayData.token.id,
          decimals: Number(tokenDayData.token.decimals),
          name: tokenDayData.token.name,
          symbol: tokenDayData.token.symbol,
          totalSupply: tokenDayData.token.totalSupply,
          priceUSD: _.round(tokenDayData.priceUSD, USD_DECIMALS),
        });
      }
    }

    return response;
  }
}

const UniswapSubgraphV3 = new UniswapSubgraphClassV3();

export { UniswapSubgraphV3 };
