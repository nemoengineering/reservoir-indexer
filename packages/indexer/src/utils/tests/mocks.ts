process.env.IS_TESTNET = "0";
import { idb, ridb } from "@/common/db";
import { bn, fromBuffer, toBuffer } from "@/common/utils";
import { IGetTopTokens } from "../subgraphs/types";
import { BackfillUniswapV3PricesJob } from "@/jobs/backfill/backfill-uniswap-v3-prices";
import FetchCurrenciesPriceJob, {
  FetchCurrenciesPriceJobPayload,
} from "@/jobs/currencies/fetch-currencies-price-job";
import { CurrenciesPriceProvider } from "../currencies";
import UpdateTopCurrenciesJob, {
  UpdateTopCurrenciesJobPayload,
} from "@/jobs/currencies/update-top-currencies-job";
import crypto from "crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock("@/jobs/currencies/currencies-fetch-job", () => {
  return {
    addToQueue: () => jest.fn(),
  };
});

const getWallet = () => {
  return "0xE515bC3145ae9e944bD94605D57f23543e7B226A";
};

// NOTE - this will pull 1000 top currencies
const insertTopCurrencies = async (dayBeginningTimestamp?: number) => {
  const payload = {
    dayBeginningTimestamp,
  } as UpdateTopCurrenciesJobPayload;
  const updateTopCurrenciesJob = new UpdateTopCurrenciesJob();
  await updateTopCurrenciesJob.process(payload);
};

const insertCurrencies = async (tokens: IGetTopTokens[]) => {
  for (const token of tokens) {
    await idb.query(
      `INSERT INTO currencies (contract, name, symbol, decimals, metadata, total_supply)
          VALUES ($/contract/, $/name/, $/symbol/, $/decimals/, $/metadata/, $/totalSupply/) ON CONFLICT (contract) DO NOTHING;`,
      {
        contract: toBuffer(token.id),
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        metadata: {},
        totalSupply: token.totalSupply,
      }
    );
  }
};

const insertCurrencyProviders = async (tokens: IGetTopTokens[], provider: string) => {
  for (const token of tokens) {
    await idb.query(
      `INSERT INTO currencies_pricing_provider (contract, provider, metadata)
        VALUES ($/contract/, $/provider/, $/metadata/) ON CONFLICT (contract, provider) DO NOTHING;`,
      {
        contract: toBuffer(token.id),
        metadata: {},
        provider,
      }
    );
  }
};

const getLastTokenPricing = async (provider: string) => {
  const tokens = await ridb.manyOrNone(
    `
          SELECT currency
          FROM usd_prices_minutely
          WHERE provider = $/provider/
          ORDER BY timestamp desc
        `,
    { provider }
  );
  return tokens;
};

const insertUsdPricesMinutely = async (provider: string, startTime: number, iterations = 60) => {
  const fetchCurrenciesPriceJob = new FetchCurrenciesPriceJob();
  const payload = {
    provider,
    timestamp: startTime,
  } as FetchCurrenciesPriceJobPayload;

  for (let i = 0; i < iterations; i++) {
    await fetchCurrenciesPriceJob.process(payload);
    payload.timestamp = payload.timestamp + 60;
  }
};

const backfillUsdPrices = async (
  provider: CurrenciesPriceProvider,
  backfillPrices = true,
  backfillVolume = true,
  hours = 48,
  days = 10
) => {
  const backfill = new BackfillUniswapV3PricesJob();
  const payload = { backfillPrices, backfillVolume, hours, days, provider };
  await backfill.process(payload);
};

const insertFtBalances = async (tokens: IGetTopTokens[], wallet: string) => {
  const insertQuery = `
    insert into ft_balances (contract, owner, amount) values ($/contract/, $/wallet/, $/amount/) 
    ON CONFLICT (contract, owner) DO UPDATE SET amount = EXCLUDED.amount;
  `;

  for (const token of tokens) {
    await idb.none(insertQuery, {
      contract: toBuffer(token.id),
      wallet: toBuffer(wallet),
      amount: 100,
    });
  }
};

const setUtcTimeZone = async () => {
  await idb.none(`SET TIME ZONE 'GMT';`, {});
};

const generateRandomString = (length: number) => {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
};

const getRandomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

const insertBalances = async (tokens: any[]) => {
  const contracts = tokens.map((tkn: any) => fromBuffer(tkn.contract));
  const insertQuery = `
            insert into ft_balances (contract, owner, amount) values ($/contract/, $/wallet/, $/amount/) ON CONFLICT (contract, owner) DO UPDATE SET amount = EXCLUDED.amount;
        `;

  for (let i = 0; i < tokens.length; i++) {
    await idb.none(insertQuery, {
      contract: toBuffer(contracts[i]),
      wallet: toBuffer(getWallet()),
      amount: Number(bn(getRandomInt(1, 1000)).pow(tokens[i].decimals - 2)),
    });
  }
};

export {
  insertCurrencies,
  insertUsdPricesMinutely,
  backfillUsdPrices,
  insertFtBalances,
  getWallet,
  insertCurrencyProviders,
  setUtcTimeZone,
  insertTopCurrencies,
  generateRandomString,
  getRandomInt,
  insertBalances,
  getLastTokenPricing,
};
