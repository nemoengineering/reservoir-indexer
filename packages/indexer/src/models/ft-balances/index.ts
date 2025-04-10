import { config } from "@/config/index";
import { redb } from "@/common/db";
import { bn, toBuffer } from "@/common/utils";
import { redis } from "@/common/redis";
import { baseProvider } from "@/common/provider";
import { logger } from "@/common/logger";

export class FtBalances {
  public static async getNativeBalance(wallet: string, forceRpcCall = true) {
    let nativeBalance = bn("0");

    try {
      // For zksync chains native balance can be fetched from nativeErc20Tracker
      if (!forceRpcCall && config.nativeErc20Tracker) {
        const nativeBalanceResult = await redb.oneOrNone(
          `
            SELECT amount
            FROM ft_balances
            WHERE owner = $/owner/
            AND contract = $/contract/
            AND amount > 0
        `,
          {
            owner: toBuffer(wallet),
            contract: toBuffer(config.nativeErc20Tracker),
          }
        );

        nativeBalance = nativeBalanceResult ? bn(nativeBalanceResult.amount) : bn("0");
      } else {
        const nativeBalanceCacheKey = `onchain-native-balance:${wallet}`;
        const cachedBalance = await redis.get(nativeBalanceCacheKey);

        if (!cachedBalance) {
          // No cache found get balance from on chain
          nativeBalance = await baseProvider.getBalance(wallet);
          await redis.set(nativeBalanceCacheKey, nativeBalance.toString(), "EX", 60);
        } else {
          nativeBalance = bn(cachedBalance);
        }
      }
    } catch (error) {
      logger.error(
        "fetch-native-balance",
        `Failed to fetch native balance ${JSON.stringify(error)}`
      );
    }

    return nativeBalance;
  }
}
