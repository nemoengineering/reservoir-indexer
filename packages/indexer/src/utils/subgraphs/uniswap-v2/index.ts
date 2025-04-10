import axios from "axios";
import _ from "lodash";
import { logger } from "@/common/logger";
import {
  IGetHistoricalData,
  IGetSearchTokens,
  IGetTokensVolumesByDateResponse,
  IGetTokensWithPricingData,
  IGetTopTokens,
  IGetUsdPrice,
  IPriceUsd,
  ISubGraphError,
  ISubGraphMethod,
  ITokenDayData,
  IGetToken24HourVolumeData,
} from "../types";
import { UNISWAP_V2_QUERY } from "./queries";
import { parseUnits } from "ethers/lib/utils";
import { BigNumber } from "@ethersproject/bignumber";
import { bn } from "@/common/utils";
import { config } from "@/config/index";
import { USD_DECIMALS } from "@/utils/prices";

class UniswapSubgraphClassV2 implements ISubGraphMethod {
  public subgraphUrl = `https://gateway.thegraph.com/api/${config.uniswapSubgraphV2ApiKey}/subgraphs/id/${config.uniswapSubgraphV2Id}`;

  public getUrl(): string {
    // If we have URL use that
    if (config.uniswapSubgraphV2Url) {
      return config.uniswapSubgraphV2Url;
    }

    // Otherwise use remote subgraph
    if (config.uniswapSubgraphV2Id) {
      return UniswapSubgraphV2.subgraphUrl;
    }
    return "";
  }

  /* eslint-disable  @typescript-eslint/no-explicit-any */
  async getGraphResponse(query: string) {
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
        logger.error("UniswapSubgraphV2", `${status} - ${msg.join(",")}`);
      }
      return data;
    } catch (error: any) {
      logger.error(
        "UniswapSubgraphV2",
        JSON.stringify({
          message: `getGraphResponse error. error=${error.message}`,
          url,
          query,
          error,
        })
      );

      throw new Error("Unable to get tokens pricing data.");
    }
  }

  public async getUsdPrice(tokens: string[]): Promise<IGetUsdPrice> {
    const response: IGetUsdPrice = {};
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    const query = UNISWAP_V2_QUERY.getUsdPrice(tokens);

    // Set default response values
    for (const token of tokens) {
      response[token] = null;
    }

    const data = await this.getGraphResponse(query);

    if (data?.tokens.length) {
      data.tokens.map((token: IPriceUsd) => {
        let high = 0;
        token.tokenDayData.map(
          (dayData: ITokenDayData) => (high = Math.max(high, Number(dayData.priceUSD)))
        );

        response[token.id] = {
          priceUSD: _.round(Number(token.tokenDayData[0].priceUSD), USD_DECIMALS),
          oneDayChange: _.round(Number(token.tokenDayData[0].priceUSD) / Number(high), 6),
        };
      });
    }

    return response;
  }

  public async getTopTokens(count = 500, dayBeginningTimestamp = 0): Promise<IGetTopTokens[]> {
    const response: IGetTopTokens[] = [];
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    if (!dayBeginningTimestamp) {
      const dayBeginning = new Date();
      dayBeginning.setUTCHours(0, 0, 0, 0);
      dayBeginningTimestamp = Math.floor(dayBeginning.getTime() / 1000);
    }

    const query = UNISWAP_V2_QUERY.getTopTokens(count, dayBeginningTimestamp);

    const data = await this.getGraphResponse(query);

    // If we got info from the subgraph
    if (data?.tokenDayDatas.length) {
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

  public async getTokensWithPricingData(
    contracts: string[],
    realtimePriceOnly = false
  ): Promise<IGetTokensWithPricingData[]> {
    const response = [] as IGetTokensWithPricingData[];
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    const limit = realtimePriceOnly ? 1 : 2;
    const query = UNISWAP_V2_QUERY.getTokensWithPricingData(contracts, limit);

    const data = await this.getGraphResponse(query);

    for (const token of data.tokens) {
      if (!token.tokenDayData.length) {
        continue;
      }

      const item = {
        token: token.tokenDayData[0].token,
      };
      item.token.tokenDayData = token.tokenDayData;

      response.push(this.getPricingDataResponse(item, realtimePriceOnly));
    }

    return response;
  }

  /* eslint-disable  @typescript-eslint/no-explicit-any */
  getPricingDataResponse(tokenDayData: any, realtimePriceOnly = false) {
    const token = tokenDayData.token;

    const tokenData = token.tokenDayData[0];

    const oneDayChange = realtimePriceOnly
      ? null
      : token.tokenDayData.length > 1 &&
        token.tokenDayData[1].priceUSD &&
        Number(token.tokenDayData[1].priceUSD)
      ? _.round(Number(token.tokenDayData[0].priceUSD) / Number(token.tokenDayData[1].priceUSD), 6)
      : null;

    return {
      contract: tokenData.token.id,
      name: tokenData.token.name,
      symbol: tokenData.token.symbol,
      decimals: tokenData.token.decimals,
      totalSupply: tokenData.token.totalSupply,
      oneDayVolume: tokenData.dailyVolumeToken,
      oneDayVolumeUSD: _.round(tokenData.dailyVolumeUSD, USD_DECIMALS),
      allTimeVolume: tokenData.token.tradeVolume,
      allTimeVolumeUSD: _.round(tokenData.token.tradeVolumeUSD, USD_DECIMALS),
      priceUSD: _.round(tokenData.priceUSD, USD_DECIMALS),
      oneDayChange,
    };
  }

  public async getTopTokensWithPricingData(limit = 100): Promise<IGetTokensWithPricingData[]> {
    const tokens = [] as IGetTokensWithPricingData[];
    if (!UniswapSubgraphV2.getUrl().length) {
      return tokens;
    }
    if (limit > 1000) {
      limit = 1000;
    }
    const dayBeginning = new Date();

    dayBeginning.setUTCHours(0, 0, 0, 0);

    const dayBeginningTimestamp = Math.floor(dayBeginning.getTime() / 1000);

    const query = UNISWAP_V2_QUERY.getTopTokensWithPricingData(limit, dayBeginningTimestamp);

    const data = await this.getGraphResponse(query);

    for (const tokenDayData of data.tokenDayDatas) {
      const token = tokenDayData.token;

      const oneDayChange =
        token.tokenDayData.length > 1 &&
        token.tokenDayData[1].priceUSD &&
        Number(token.tokenDayData[1].priceUSD)
          ? _.round(
              Number(token.tokenDayData[0].priceUSD) / Number(token.tokenDayData[1].priceUSD),
              6
            )
          : null;

      tokens.push({
        contract: token.id,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply,
        oneDayVolume: token.tokenDayData[0].dailyVolumeToken,
        oneDayVolumeUSD: _.round(token.tokenDayData[0].dailyVolumeUSD, USD_DECIMALS),
        allTimeVolume: token.tradeVolume,
        allTimeVolumeUSD: _.round(token.tradeVolumeUSD, USD_DECIMALS),
        priceUSD: _.round(token.tokenDayData[0].priceUSD, USD_DECIMALS),
        oneDayChange,
      });
    }

    return tokens;
  }

  public async searchTokens(prefix: string, limit = 20): Promise<IGetSearchTokens[]> {
    const response: IGetSearchTokens[] = [];
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    const query = UNISWAP_V2_QUERY.searchTokens(prefix, limit);

    const data = await this.getGraphResponse(query);

    for (const token of data.tokens) {
      response.push({
        contract: token.id,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      });
    }

    return response;
  }

  // high low open close not available in v2
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  processHistoricalData(data: any): IGetHistoricalData {
    const response: IGetHistoricalData = {};
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    for (const tokenData of data.tokens) {
      response[tokenData.id] = _.map(tokenData.tokenDayData, (priceData) => ({
        startTimestamp: priceData.date,
        endTimestamp: priceData.date + (60 * 60 * 24 - 1),
        //   high: priceData.high,
        //   low: priceData.low,
        //   open: priceData.open,
        //   close: priceData.close,
        priceUSD: _.round(priceData.priceUSD, USD_DECIMALS),
        volumeUSD: _.round(priceData.dailyVolumeUSD, USD_DECIMALS),
        volume: priceData.dailyVolumeToken,
        decimals: Number(tokenData.decimals),
      }));
    }

    return response;
  }

  // TODO hourly not supported
  public async getHistoricPrice(
    tokens: string[],
    granularity: "day" | "hour",
    periodInDays: number
  ): Promise<IGetHistoricalData> {
    if (!UniswapSubgraphV2.getUrl().length) {
      return {} as IGetHistoricalData;
    }

    if (granularity === "day") {
      const query = UNISWAP_V2_QUERY.getHistoricalPrice(tokens, periodInDays);

      const data = await this.getGraphResponse(query);

      // If we got info from the subgraph
      if (data?.tokens.length) {
        return this.processHistoricalData(data);
      }
    } else if (granularity === "hour") {
      const fetchPricesPromises = [];

      for (const token of tokens) {
        let limit = periodInDays * 24;
        if (limit > 1000) {
          limit = 1000;
        }
        const query = UNISWAP_V2_QUERY.getHistoricalPriceHour(token, limit);

        fetchPricesPromises.push(axios.post(this.getUrl(), { query }));
      }

      const promisesResult = await Promise.all(fetchPricesPromises);
      if (promisesResult.length) {
        const merged = [];
        for (const result of promisesResult) {
          const {
            data: { data },
          } = result;
          merged.push(data.tokenHourDatas);
        }

        if (merged.length) {
          return this.processHistoricalData(merged);
        }
      }
    }
    return {} as IGetHistoricalData;
  }

  public async getTokensVolumesByDate(
    contracts: string[],
    date: number
  ): Promise<IGetTokensVolumesByDateResponse[]> {
    const response = [] as IGetTokensVolumesByDateResponse[];
    if (!UniswapSubgraphV2.getUrl().length) {
      return response;
    }

    const query = UNISWAP_V2_QUERY.getTokensVolumesByDate(contracts, date);

    const data = await this.getGraphResponse(query);

    for (const token of data.tokens) {
      response.push({
        contract: String(token.id),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        totalSupply: token.totalSupply,
        date,
        dayVolume: token.tokenDayData.length
          ? parseUnits(token.tokenDayData[0].dailyVolumeToken, token.decimals).toString()
          : "0",
        dayVolumeUSD: token.tokenDayData.length
          ? _.round(token.tokenDayData[0].dailyVolumeUSD, USD_DECIMALS)
          : 0,
        allTimeVolume: parseUnits(token.tradeVolume, token.decimals).toString(),
        allTimeVolumeUSD: _.round(token.tradeVolumeUSD, USD_DECIMALS),
      });
    }

    return response;
  }

  public async getTokens24HourVolume(
    contracts: string[],
    fromTimestamp: number,
    toTimestamp?: number
  ): Promise<IGetToken24HourVolumeData[]> {
    const data: IGetToken24HourVolumeData[] = [];

    // Chunk tokens to batch of 1000 as this is the max contracts we can pass to the subgraph
    const pairs = (
      await Promise.all(
        _.chunk(contracts, 1000).map(async (contractsChunks) => {
          const pairsQuery = UNISWAP_V2_QUERY.getPairs(contractsChunks);
          const subgraphPairsResponseData = await this.getGraphResponse(pairsQuery);

          return subgraphPairsResponseData?.pairs.map((pair: { id: string }) => pair.id);
        })
      )
    ).flat();

    if (pairs?.length) {
      // Chunk tokens to batch of 40 as this is the max tokens we can fetch 24 hour info (max limit 1000, and we need 24 hours data)
      const pairHourDatas = (
        await Promise.all(
          _.chunk(pairs, 40).map(async (pairsChunk) => {
            const query = UNISWAP_V2_QUERY.getPairs24HourVolume(
              pairsChunk,
              fromTimestamp,
              toTimestamp
            );

            const subgraphResponseData: {
              pairHourDatas: {
                pair: {
                  token0: { id: string; decimals: string };
                  token1: { id: string; decimals: string };
                };
                hourlyVolumeToken0: string;
                hourlyVolumeToken1: string;
                hourlyVolumeUSD: string;
              }[];
            } = await this.getGraphResponse(query);

            logger.info(
              "UniswapSubgraphClassV2",
              JSON.stringify({
                topic: "updateTokens24HourVolume",
                message: `getGraphResponseV2. contracts=${contracts.length}, fromTimestamp=${fromTimestamp}, pairs=${pairs.length}, pairsChunk=${pairsChunk.length}`,
                query,
                pairsChunk,
                subgraphResponseData,
              })
            );

            return subgraphResponseData?.pairHourDatas;
          })
        )
      ).flat();

      if (pairHourDatas?.length) {
        for (const contract of contracts) {
          const tokenHoursData = pairHourDatas
            .filter(
              (pairHourData) =>
                pairHourData.pair.token0.id === contract || pairHourData.pair.token1.id === contract
            )
            .reduce(
              (
                accumulator: {
                  token: { id: string; decimals: string };
                  volume: string;
                  volumeUSD: string;
                }[],
                pairHourData
              ) => {
                if (pairHourData.hourlyVolumeUSD === "0") {
                  return accumulator;
                }

                if (pairHourData.pair.token0.id === contract) {
                  accumulator.push({
                    token: {
                      id: pairHourData.pair.token0.id,
                      decimals: pairHourData.pair.token0.decimals,
                    },
                    volume: pairHourData.hourlyVolumeToken0,
                    volumeUSD: pairHourData.hourlyVolumeUSD,
                  });
                }

                if (pairHourData.pair.token1.id === contract) {
                  accumulator.push({
                    token: {
                      id: pairHourData.pair.token1.id,
                      decimals: pairHourData.pair.token1.decimals,
                    },
                    volume: pairHourData.hourlyVolumeToken1,
                    volumeUSD: pairHourData.hourlyVolumeUSD,
                  });
                }

                return accumulator;
              },
              []
            );

          if (tokenHoursData.length) {
            const volume = tokenHoursData.reduce(
              (accumulator: BigNumber, tokenHourData) =>
                accumulator.add(parseUnits(tokenHourData.volume, tokenHourData.token.decimals)),
              bn(0)
            );

            const volumeUSD = tokenHoursData.reduce(
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
    }

    return data;
  }
}

const UniswapSubgraphV2 = new UniswapSubgraphClassV2();

export { UniswapSubgraphV2 };
