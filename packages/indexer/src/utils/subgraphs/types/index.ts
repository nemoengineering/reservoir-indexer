export interface IUsdPrice {
  priceUSD: number;
  oneDayChange: number | null;
}

export interface ISubGraphMethod {
  getUrl(): string;
  getUsdPrice(tokens: string[]): Promise<IGetUsdPrice>;
  getHistoricPrice(
    tokens: string[],
    granularity: "day" | "hour",
    periodInDays: number
  ): Promise<IGetHistoricalData>;
  getTokensWithPricingData(
    contracts: string[],
    realtimePriceOnly: boolean
  ): Promise<IGetTokensWithPricingData[]>;
  getTopTokensWithPricingData(limit: number): Promise<IGetTokensWithPricingData[]>;
  searchTokens(prefix: string, limit: number): Promise<IGetSearchTokens[]>;
  getTopTokens(count: number, dayBeginningTimestamp: number): Promise<IGetTopTokens[]>;
  getTokensVolumesByDate(
    contracts: string[],
    date: number
  ): Promise<IGetTokensVolumesByDateResponse[]>;
  getTokens24HourVolume(
    contracts: string[],
    fromTimestamp: number,
    toTimestamp?: number
  ): Promise<IGetToken24HourVolumeData[]>;
}

export interface IGetToken24HourVolumeData {
  contract: string;
  volume: string;
  volumeUSD: string;
}

export interface IGetTokensVolumesByDateResponse {
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  date: number;
  dayVolume: string;
  dayVolumeUSD: number;
  allTimeVolume: string;
  allTimeVolumeUSD: number;
}

export interface IGetTokensWithPricingData {
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  oneDayVolume: string;
  oneDayVolumeUSD: number;
  allTimeVolume: string;
  allTimeVolumeUSD: number;
  priceUSD: number;
  oneDayChange: number | null;
}

export interface IGetUsdPrice {
  [key: string]: { priceUSD: number; oneDayChange: number | null } | null;
}

export interface IGetHistoricalData {
  [key: string]:
    | {
        startTimestamp: number;
        endTimestamp: number;
        high?: string;
        low?: string;
        open?: string;
        close?: string;
        priceUSD: number;
        volumeUSD: number;
        volume: string;
        decimals: number;
      }[]
    | null;
}

export interface IGetSearchTokens {
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface IGetTopTokens {
  id: string;
  decimals: number;
  name: string;
  symbol: string;
  totalSupply: string;
  priceUSD: number;
}

export interface ISubGraphError {
  message: string;
}

export interface IPriceUsd {
  id: string;
  tokenDayData: ITokenDayData[];
}

export interface ITokenDayData {
  priceUSD: string;
  token?: IGetTopTokens;
}
