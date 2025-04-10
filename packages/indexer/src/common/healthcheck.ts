import { logger } from "@/common/logger";
import { acquireLock, redis } from "@/common/redis";
import { hdb } from "@/common/db";
import { config } from "@/config/index";
import { now } from "@/common/utils";
import { getLastReceivedEventTimestamp } from "@/websockets/opensea";

export class HealthCheck {
  static async check(): Promise<boolean> {
    try {
      await hdb.query("SELECT 1");
    } catch (error) {
      logger.error("healthcheck", `Postgres Healthcheck failed: ${error}`);
      return false;
    }

    try {
      await redis.ping();
    } catch (error) {
      logger.error("healthcheck", `Redis Healthcheck failed: ${error}`);
      return false;
    }

    try {
      const lockAcquired = await acquireLock("healthcheck-blocks-init", 60);

      if (lockAcquired) {
        await hdb.query(
          "INSERT INTO blocks (hash, number, timestamp) VALUES ('0', 0, 0) ON CONFLICT DO NOTHING"
        );
        await hdb.query("DELETE FROM blocks WHERE hash='0' AND number=0 AND timestamp=0");
      }
    } catch (error) {
      logger.error("healthcheck", `Postgres Block init failed: ${error}`);
    }

    if (
      config.master &&
      config.enableWebSocket &&
      !config.isTestnet &&
      config.enableWebsocketHealthCheck
    ) {
      const timestamp = await redis.get("latest-block-websocket-received");
      const currentTime = now();
      if (timestamp && Number(timestamp) < currentTime - 60) {
        if (Number(timestamp) < currentTime - 180) {
          logger.error(
            "healthcheck",
            `last realtime websocket received ${timestamp} ${currentTime - Number(timestamp)}s ago`
          );
          return false;
        }

        logger.info(
          "healthcheck",
          `last realtime websocket received ${timestamp} ${currentTime - Number(timestamp)}s ago`
        );
      }
    }

    if (config.doWebsocketWork && config.openSeaApiKey && !config.isTestnet) {
      const timestamp = getLastReceivedEventTimestamp();
      const currentTime = now();

      if (timestamp && Number(timestamp) < currentTime - 60) {
        if (Number(timestamp) < currentTime - 180) {
          logger.warn(
            "healthcheck",
            `last opensea websocket received ${timestamp} ${currentTime - Number(timestamp)}s ago`
          );

          // return false;
        }

        logger.info(
          "healthcheck",
          `last opensea websocket received ${timestamp} ${currentTime - Number(timestamp)}s ago`
        );
      }
    }

    return true;
  }
}
