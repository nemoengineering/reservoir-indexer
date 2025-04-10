export const UNISWAP_V2_QUERY = {
  getUsdPrice: (tokens: string[]) => `
        {
          tokens(where: { id_in: ["${tokens.join('","')}"] }) {
              tokenDayData (orderBy: date, orderDirection:desc) { 
                  priceUSD  
              }
              id
          }
        }`,
  getTopTokens: (limit: number, timestamp: number) => `
          {
            tokenDayDatas(first: ${limit}, orderBy: dailyVolumeUSD, orderDirection: desc, where: { date_gte: ${timestamp} }) {
              priceUSD
              token {
                id
                symbol
                name
                decimals
                totalSupply
              }
            }
          }
        `,
  getHistoricalPrice: (tokens: string[], limit: number) => `
              {
                tokens(where: { id_in: ["${tokens.join('","')}"] }) {
                  id
                  decimals
                  tokenDayData (first: ${limit}, orderBy: date, orderDirection:desc) {
                    date
                    priceUSD  
                    dailyVolumeUSD
                    dailyVolumeToken
                  }
                }
              }
            `,
  getHistoricalPriceHour: (token: string, limit: number) => `
            {
              tokenHourDatas(first: ${limit}, where: {token: "${token}"}, orderBy: periodStartUnix, orderDirection: desc) {
                token {
                  id
                  decimals
                }
                periodStartUnix
                priceUSD
                dailyVolumeUSD
                dailyVolumeToken
              }
            }
          `,
  getTokensWithPricingData: (tokens: string[], limit: number) => `
          {
              tokens(where: { id_in: ["${tokens.join('","')}"] }) {
              tokenDayData (first: ${limit}, orderBy: date, orderDirection: desc) {
                token { 
                  id
                  symbol
                  name
                  decimals
                  totalSupply
                  tradeVolume
                  tradeVolumeUSD
                }
                dailyVolumeUSD
                dailyVolumeToken
                priceUSD 
              }
            }
          }
        `,
  getTopTokensWithPricingData: (limit: number, timestamp: number) => `
          {
            tokenDayDatas(first: ${limit}, orderBy: dailyVolumeUSD, orderDirection: desc, where: { date_gte: ${timestamp} }) {
              token {
                    id
                    symbol
                    name
                    decimals
                    totalSupply
                    tradeVolume
                    tradeVolumeUSD
                    tokenDayData (first: 2, orderBy: date, orderDirection: desc) {
                      dailyVolumeUSD
                      dailyVolumeToken
                      priceUSD 
                    }
              }
            }
          }
        `,
  searchTokens: (keyword: string, limit: number) => `
        {
          tokens(where: { or: [ { id: "${keyword}" }, { name_starts_with_nocase: "${keyword}" }, { symbol_starts_with_nocase: "${keyword}" } ] }, first: ${limit}, orderBy: tradeVolumeUSD, orderDirection: desc) {
            id
            name
            symbol
            decimals
          }
        }
      `,
  getTokensVolumesByDate: (tokens: string[], timestamp: number) => `
            {
                tokens(where: { id_in: ["${tokens.join('","')}"] }) {
                id
                symbol
                name
                decimals
                totalSupply
                tradeVolume
                tradeVolumeUSD
                tokenDayData (where: { date: ${timestamp} }) {
                  date
                  dailyVolumeUSD
                  dailyVolumeToken
                }
              }
            }
          `,
  getPairs: (contracts: string[], limit = 1000, skip = 0) => `
      {
        pairs(
          first: ${limit}
          skip: ${skip}
          where: {
            or: [
              {
                token0_in: [${contracts.map((contract) => `"${contract}"`).join(",")}]
                token1_in: [${contracts.map((contract) => `"${contract}"`).join(",")}]
              }
            ]
          }
        ) {
          id
        }
      }
      `,
  getPairs24HourVolume: (pairs: string[], fromTimestamp: number, toTimestamp?: number) => `
    {
      pairHourDatas(
        first: 1000
        orderBy: hourStartUnix
        where: {
          hourStartUnix_gte: 1737679548
          pair_in: [${pairs.map((pair) => `"${pair}"`).join(",")}]
          hourStartUnix_gte: ${fromTimestamp}
          ${toTimestamp ? `hourStartUnix_lt:${toTimestamp}` : ""}
        }
      ) {
        id
        hourlyVolumeToken0
        hourlyVolumeToken1
        hourlyVolumeUSD
        hourStartUnix
        pair {
          id
          token0 {
            id
          }
          token1 {
            id
          }
        }
      }
    }
      `,
};
