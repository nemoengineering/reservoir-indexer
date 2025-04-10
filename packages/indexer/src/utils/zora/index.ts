import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import * as Sdk from "@reservoir0x/sdk";

import { baseProvider } from "@/common/provider";
import { config } from "@/config/index";
import { getMarket, saveMarket } from "@/models/zora-pools";

export const getMarketDetails = async (address: string, skipOnChainCheck = false) => {
  const market = await getMarket(address);
  if (!market && !skipOnChainCheck && Sdk.ZoraV4.Addresses.SecondarySwap[config.chainId]) {
    const iface = new Interface([
      `function tokenInfo() view returns (
        (
          address collection,
          uint256 tokenId,
          address creator
        ) info
      )`,
      `function tokenLiquidityInfo() view returns (
        address pool,
        uint256 initialLiquidityPositionId
      )`,
    ]);

    try {
      const market = new Contract(address, iface, baseProvider);
      const [tokenInfo, tokenLiquidityInfo] = await Promise.all([
        market.tokenInfo(),
        market.tokenLiquidityInfo(),
      ]);
      const collection = tokenInfo.collection.toLowerCase();
      const tokenId = tokenInfo.tokenId.toString();
      const pool = tokenLiquidityInfo.pool.toLowerCase();

      return saveMarket({
        address,
        collection,
        tokenId,
        pool,
      });
    } catch {
      // Skip any errors
    }
  }

  return market;
};
