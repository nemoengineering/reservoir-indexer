import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { keccak256 } from "@ethersproject/keccak256";
import { randomBytes } from "@ethersproject/random";
import { toUtf8Bytes, toUtf8String } from "@ethersproject/strings";
import { verifyTypedData } from "@ethersproject/wallet";
import { TypedDataDomain, TypedDataField } from "ethers";

import * as Global from "./global";

// Constants

export const BytesEmpty = "0x";
export const MaxUint256 = BigNumber.from("0x" + "f".repeat(64));

// Random

export const getRandomBytes = (numBytes = 32) => bn(randomBytes(numBytes));

export const generateRandomSalt = () => {
  return `0x${Buffer.from(randomBytes(8)).toString("hex").padStart(24, "0")}`;
};

// BigNumber

export const bn = (value: BigNumberish) => BigNumber.from(value);

// Time

export const getCurrentTimestamp = (delay = 0) => Math.floor(Date.now() / 1000 + delay);

// Ease of use

export const lc = (x: string) => x?.toLowerCase();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const n = (x: any) => (x ? Number(x) : x);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const s = (x: any) => (x || x === 0 ? String(x) : x);

export const uniqBy = <T>(items: T[], uniqId: (item: T) => string): T[] => {
  const result: T[] = [];
  const uniqItems = new Set<string>();
  for (const item of items) {
    const id = uniqId(item);
    if (!uniqItems.has(id)) {
      result.push(item);
      uniqItems.add(id);
    }
  }
  return result;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getErrorMessage = (error: any, source?: string) => {
  const errorMessage = error.response?.data ? JSON.stringify(error.response.data) : error.message;

  if (source) {
    try {
      return JSON.stringify({
        message: error.response?.data ? error.response.data : error.message,
        source: source,
      });
    } catch (err) {
      // Do nothing
    }
  }

  return errorMessage;
};

export function checkEIP721Signature(
  data: {
    domain: TypedDataDomain;
    types: Record<string, TypedDataField[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: Record<string, any>;
  },
  signature: string,
  signer: string
) {
  try {
    const recoveredSigner = verifyTypedData(data.domain, data.types, data.value, signature);
    if (lc(signer) === lc(recoveredSigner)) {
      return true;
    }
  } catch {
    // Skip errors
  }

  return false;
}

// Misc

export const getSourceHash = (source?: string, defaultValue = "") =>
  source ? keccak256(toUtf8Bytes(source)).slice(2, 10) : defaultValue;

export const generateSourceBytes = (source?: string) => {
  return getSourceHash(Global.Config.aggregatorSource) + getSourceHash(source, "00000000");
};

export const getSourceV1 = (calldata: string) => {
  // Use the ASCII US (unit separator) character (code = 31) as a delimiter
  const SEPARATOR = "1f";

  // Only allow printable ASCII characters
  const isPrintableASCII = (value: string) => /^[\x20-\x7F]*$/.test(value);

  try {
    if (calldata.endsWith(SEPARATOR)) {
      const index = calldata.slice(0, -2).lastIndexOf(SEPARATOR);
      // If we cannot find the separated source string within the last
      // 32 bytes of the calldata, we simply assume it is missing
      if (index === -1 || calldata.length - index - 5 > 64) {
        return undefined;
      } else {
        const result = toUtf8String("0x" + calldata.slice(index + 2, -2));
        if (isPrintableASCII(result)) {
          return result;
        } else {
          return undefined;
        }
      }
    }
  } catch {
    return undefined;
  }
};

// Types

export type TxData = {
  from: string;
  to: string;
  data: string;
  value?: string;
  gas?: string;
};

export enum Network {
  // Mainnets
  Ethereum = 1,
  Optimism = 10,
  Bsc = 56,
  Polygon = 137,
  Base = 8453,
  Arbitrum = 42161,
  ArbitrumNova = 42170,
  Avalanche = 43114,
  Linea = 59144,
  Zora = 7777777,
  PolygonZkevm = 1101,
  Scroll = 534352,
  Opbnb = 204,
  Ancient8 = 888888888,
  Apex = 70700,
  Blast = 81457,
  AstarZkevm = 3776,
  Degen = 666666666,
  Xai = 660279,
  Nebula = 1482601649,
  Cyber = 7560,
  Bitlayer = 200901,
  Sei = 1329,
  SocialNetwork = 149,
  Boss = 70701,
  Forma = 984122,
  B3 = 8333,
  Apechain = 33139,
  Shape = 360,
  Hychain = 2911,
  Flow = 747,
  Zero = 543210,
  Abstract = 2741,
  Game7 = 2187,
  Soneium = 1868,
  Ink = 57073,
  Berachain = 80094,
  Anime = 69000,
  // Testnets
  EthereumGoerli = 5,
  MantleTestnet = 5001,
  LineaTestnet = 59140,
  Mumbai = 80001,
  EthereumSepolia = 11155111,
  Zksync = 324,
  Ancient8Testnet = 28122024,
  ImmutableZkevmTestnet = 13472,
  FrameTestnet = 68840142,
  BaseSepolia = 84532,
  BlastSepolia = 168587773,
  ApexTestnet = 70800,
  BerachainTestnet = 80084,
  Garnet = 17069,
  Redstone = 690,
  Amoy = 80002,
  SeiTestnet = 713715,
  SocialNetworkTestnet = 749,
  B3Testnet = 1993,
  FlowPreviewnet = 646,
  Game7Testnet = 13746,
  Cloud = 70805,
  FormaSketchpad = 984123,
  ShapeSepolia = 11011,
  Curtis = 33111,
  AbstractTestnet = 11124,
  Minato = 1946,
  HychainTestnet = 29112,
  ZeroTestnet = 43210,
  AnimeTestnet = 6900,
  CreatorTestnet = 4654,
  StoryOdyssey = 1516,
  MonadTestnet = 10143,
}

export type ChainIdToAddress = { [chainId: number]: string };
export type ChainIdToAddressList = { [chainId: number]: string[] };

function createAddressResolver<T extends { [chainId: number]: string | string[] }>(
  sdk: string,
  type: string,
  fallback: T
): T {
  return new Proxy(fallback, {
    get(_, prop: string | symbol) {
      if (typeof prop !== "string" || isNaN(Number(prop))) {
        return undefined;
      }

      const chainId = Number(prop);
      const addresses = Global.Config?.addresses;
      if (!addresses) {
        return fallback[chainId];
      }

      const sdkAddresses = addresses[sdk];
      if (!sdkAddresses) {
        return fallback[chainId];
      }

      return (sdkAddresses[type][chainId] as T[keyof T]) || fallback[chainId];
    },
  });
}

export function resolveAddress(
  sdk: string,
  type: string,
  fallback?: ChainIdToAddress
): ChainIdToAddress {
  return createAddressResolver<ChainIdToAddress>(sdk, type, fallback ?? {});
}

export function resolveAddressList(
  sdk: string,
  type: string,
  fallback?: ChainIdToAddressList
): ChainIdToAddressList {
  return createAddressResolver<ChainIdToAddressList>(sdk, type, fallback ?? {});
}
