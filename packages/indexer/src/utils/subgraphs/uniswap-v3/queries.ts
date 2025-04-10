export const UNISWAP_V3_QUERY = {
  getUsdPrice: (tokens: string[]) => `
        {
          tokens(where: { id_in: ["${tokens.join('","')}"] }) {
            tokenDayData (first: 2, orderBy: date, orderDirection:desc) {
              token {
                id
              }
              priceUSD
              high
            }
          }
        }
      `,
  getTopTokens: (limit: number, timestamp: number) => `
  {
    tokenDayDatas(first: ${limit}, orderBy: volumeUSD, orderDirection: desc, where: { date_gte: ${timestamp} }) {
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
  getHistoricPriceDay: (tokens: string[], limit: number) => `
        {
          tokens(where: { id_in: ["${tokens.join('","')}"] }) {
            id
            decimals
            tokenDayData (first: ${limit}, orderBy: date, orderDirection:desc) {
              date
              priceUSD
              high
              low
              open
              close
              volume
              volumeUSD
            }
          }
        }
      `,
  getHistoricPriceHour: (token: string, limit: number) => `
            {
              tokenHourDatas(first: ${limit}, where: {token: "${token}"}, orderBy: periodStartUnix, orderDirection: desc) {
                token {
                  id
                  decimals
                }
                periodStartUnix
                priceUSD
                high
                low
                open
                close
                volume
                volumeUSD
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
                volume
                volumeUSD
              }
              volume
              volumeUSD
              priceUSD
              high
            }
          }
        }
      `,
  getTopTokensWithPricingData: (limit: number, timestamp: number) => `
        {
          tokenDayDatas(first: ${limit}, orderBy: volumeUSD, orderDirection: desc, where: { date_gte: ${timestamp} }) {
            token {
                  id
                  symbol
                  name
                  decimals
                  totalSupply
                  volume
                  volumeUSD
                  tokenDayData (first: 2, orderBy: date, orderDirection: desc) {
                    volume
                    volumeUSD
                    priceUSD
                    high
                  }
            }
          }
        }
      `,
  searchTokens: (keyword: string, limit: number) => `
          {
            tokens(where: { or: [ { id: "${keyword}" }, { name_starts_with_nocase: "${keyword}" }, { symbol_starts_with_nocase: "${keyword}" } ] }, first: ${limit}, orderBy: volumeUSD, orderDirection: desc) {
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
            volume
            volumeUSD
            tokenDayData (where: { date: ${timestamp} }) {
              date
              volume
              volumeUSD
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
  getTokens24HourVolume: (contracts: string[], fromTimestamp: number, toTimestamp?: number) => `
      {
        tokenHourDatas(
          first: 1000
          where: {
            token_in: [${contracts.map((contract) => `"${contract}"`).join(",")}]
            periodStartUnix_gte: ${fromTimestamp}
            ${toTimestamp ? `periodStartUnix_lt:${toTimestamp}` : ""}
          }
        ) {
          token {
            id
            decimals
          }
          volume
          volumeUSD
        }
      }
      `,
};
