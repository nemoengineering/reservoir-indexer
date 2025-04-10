/* eslint-disable @typescript-eslint/no-explicit-any */

import { StaticJsonRpcProvider, WebSocketProvider } from "@ethersproject/providers";
import getUuidByString from "uuid-by-string";
import { logger } from "@/common/logger";
import { bn } from "@/common/utils";
import { config } from "@/config/index";
import { ConnectionInfo } from "@ethersproject/web";
import { Networkish } from "@ethersproject/networks";

class PrefixedStaticJsonRpcProvider extends StaticJsonRpcProvider {
  public constructor(url?: ConnectionInfo, network?: Networkish) {
    super(url, network);
  }

  public static getPrefix(fullMethodName: string) {
    switch (true) {
      case [1329, 713715].includes(config.chainId) &&
        ["eth_getBlockByNumber", "eth_getBlockReceipts", "eth_getLogs"].includes(fullMethodName):
        return "sei_";
    }

    return "";
  }

  prepareRequest(method: string, params: any): [string, any[]] {
    const superParams = super.prepareRequest(method, params);

    if (superParams && PrefixedStaticJsonRpcProvider.getPrefix(superParams[0])) {
      return [
        superParams[0].replace("eth_", PrefixedStaticJsonRpcProvider.getPrefix(superParams[0])),
        superParams[1],
      ];
    }

    return superParams;
  }
}

const getBaseProviderHeaders = () => {
  const headers: { [key: string]: string } = {};
  if ([0].includes(config.chainId)) {
    headers["x-session-hash"] = getUuidByString(`${config.baseNetworkHttpUrl}${config.chainId}`);
  }

  if (config.thirdWebSecret) {
    headers["x-secret-key"] = config.thirdWebSecret;
  }

  return headers;
};

export const baseProvider = new PrefixedStaticJsonRpcProvider(
  {
    url: config.baseNetworkHttpUrl,
    headers: getBaseProviderHeaders(),
  },
  config.chainId
);

export const l1BaseProvider = new PrefixedStaticJsonRpcProvider(
  {
    url: config.l1BaseNetworkHttpUrl ?? "",
    headers: getBaseProviderHeaders(),
  },
  config.l1ChainId
);

export const baseProviderWithTimeout = (timeout: number) =>
  new PrefixedStaticJsonRpcProvider(
    {
      url: config.baseNetworkHttpUrl,
      timeout,
      headers: getBaseProviderHeaders(),
    },
    config.chainId
  );

export const backfillProvider = new PrefixedStaticJsonRpcProvider(
  {
    url: config.baseNetworkBackfillUrl,
    headers: getBaseProviderHeaders(),
  },
  config.chainId
);

export const archiveProvider = new PrefixedStaticJsonRpcProvider(
  {
    url: config.baseNetworkArchiveUrl,
    headers: getBaseProviderHeaders(),
  },
  config.chainId
);

export const metadataIndexingBaseProvider = new PrefixedStaticJsonRpcProvider(
  {
    url: config.baseNetworkMetadataIndexingUrl,
    headers: [1, 324].includes(config.chainId)
      ? {}
      : {
          "x-session-hash": getUuidByString(
            `${config.baseNetworkMetadataIndexingUrl}${config.chainId}`
          ),
        },
  },
  config.chainId
);

// https://github.com/ethers-io/ethers.js/issues/1053#issuecomment-808736570
export const safeWebSocketSubscription = (
  callback: (provider: WebSocketProvider) => Promise<void>,
  wsUrl?: string
) => {
  const webSocketProvider = new WebSocketProvider(wsUrl ?? config.baseNetworkWsUrl);
  webSocketProvider.on("error", (error) => {
    logger.error("websocket-provider", `WebSocket subscription failed: ${error}`);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webSocketProvider._websocket.on("error", (error: any) => {
    logger.error("websocket-provider", `WebSocket subscription failed: ${error}`);
  });

  let pingTimeout: NodeJS.Timeout | undefined;
  let keepAliveInterval: NodeJS.Timer | undefined;

  const EXPECTED_PONG_BACK = 15000;
  const KEEP_ALIVE_CHECK_INTERVAL = 7500;
  webSocketProvider._websocket.on("open", async () => {
    keepAliveInterval = setInterval(() => {
      webSocketProvider._websocket.ping();

      pingTimeout = setTimeout(() => {
        webSocketProvider._websocket.terminate();
      }, EXPECTED_PONG_BACK);
    }, KEEP_ALIVE_CHECK_INTERVAL);

    await callback(webSocketProvider);
  });

  webSocketProvider._websocket.on("close", () => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
    }
    if (pingTimeout) {
      clearTimeout(pingTimeout);
    }
    safeWebSocketSubscription(callback);
  });

  webSocketProvider._websocket.on("pong", () => {
    if (pingTimeout) {
      clearInterval(pingTimeout);
    }
  });
};

export const getGasFee = async () =>
  baseProvider.getBlock("latest").then((b) => bn(b.baseFeePerGas ?? "0"));
