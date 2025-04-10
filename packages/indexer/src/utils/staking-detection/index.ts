import { whatsabi } from "@shazow/whatsabi";
import * as qs from "querystring";
import axios from "axios";

import { logger } from "@/common/logger";
import { baseProvider } from "@/common/provider";

const STAKE_CONTRACT_KEYWORDS = ["stake", "lock", "releasable"];

const lookupFunctions = async (functions: string[] = [], events: string[] = []) => {
  try {
    const { data } = await axios.get(
      `https://sig.eth.samczsun.com/api/v1/signatures?${qs.stringify({
        function: functions,
        event: events,
      })}`
    );
    return {
      functions: functions
        .map(
          (hex, id) =>
            (data.result.function[hex] || []).map((record: { name: string }) => ({
              id,
              created_at: "",
              text_signature: record.name,
              hex_signature: hex,
              bytes_signature: "",
            }))[0]
        )
        .filter((_) => _),
      events: events
        .map(
          (hex, id) =>
            (data.result.event[hex] || []).map((record: { name: string }) => ({
              id,
              created_at: "",
              text_signature: record.name,
              hex_signature: hex,
              bytes_signature: "",
            }))[0]
        )
        .filter((_) => _),
    };
  } catch (error) {
    // Skip errors
    logger.info(
      "staking-detection",
      JSON.stringify({
        error,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stack: (error as any).stack,
      })
    );
  }

  return {
    functions: [],
    events: [],
  };
};

const getContractSelectors = async (contract: string): Promise<string[]> => {
  let r = await whatsabi.autoload(contract, {
    provider: baseProvider,
    abiLoader: false,
    signatureLookup: false,
  });

  let depth = 0;
  while (depth < 5) {
    if (!r.followProxies) {
      break;
    }

    r = await r.followProxies();

    depth++;
  }

  const selectors: string[] = [];
  r.abi.forEach((c) => {
    if (c.type != "event") {
      selectors.push(c.selector);
    }
  });

  return selectors;
};

export const getContractInfo = async (contract: string) =>
  lookupFunctions(await getContractSelectors(contract));

export const checkContractHasStakingKeywords = async (contract: string) => {
  const info = await getContractInfo(contract);

  const matched = info.functions.some((c) =>
    STAKE_CONTRACT_KEYWORDS.some((keyword) => c.text_signature.toLowerCase().includes(keyword))
  );
  return matched;
};
