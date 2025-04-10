import { logger } from "@/common/logger";
import { Channel } from "@/pubsub/channels";
import { clearCache } from "@/utils/currencies";

export class CurrencyUpdatedEvent {
  public static async handleEvent(message: string) {
    const parsedMessage = JSON.parse(message);
    clearCache(parsedMessage.currency);

    logger.debug(Channel.CurrencyUpdated, `Reloaded currency=${parsedMessage.currency}`);
  }
}
