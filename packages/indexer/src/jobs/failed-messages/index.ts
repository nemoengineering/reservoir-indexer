import { config } from "@/config/index";
import cron from "node-cron";
import { FailedPublishMessages } from "@/models/failed-publish-messages-list";
import _ from "lodash";
import { RabbitMq, RabbitMQMessage } from "@/common/rabbit-mq";
import { acquireLock, releaseLock } from "@/common/redis";
import { logger } from "@/common/logger";
import { RabbitMqJobsConsumer } from "@/jobs/index";

if (config.doBackgroundWork) {
  cron.schedule("* * * * * *", async () => {
    const limit = 500;
    const lockName = "republish-failed-messaged";
    const failedPublishMessages = new FailedPublishMessages();
    const messages = await failedPublishMessages.get(limit);

    if (!_.isEmpty(messages)) {
      // If messages are pending to be republished get a lock and publish all pending messages
      if (!(await acquireLock(lockName, 60 * 60 * 10))) {
        return;
      }

      logger.info("rabbit-message-republish", `republishing ${messages.length} messages`);
      const mergedMessagesByQueue: { [key: string]: RabbitMQMessage[] } = {};

      // Merge messages by queue
      for (const msg of messages) {
        if (_.has(mergedMessagesByQueue, msg.queue)) {
          mergedMessagesByQueue[msg.queue].push(msg.payload);
        } else {
          mergedMessagesByQueue[msg.queue] = [msg.payload];
        }
      }

      // Republish messages in batches
      for (const [queueName, payload] of Object.entries(mergedMessagesByQueue)) {
        const job = _.find(
          RabbitMqJobsConsumer.getQueues(),
          (queue) => queue.getQueue() === queueName
        );

        if (job) {
          await RabbitMq.sendBatch(
            queueName,
            job,
            payload.map((p) => ({ content: p }))
          );
        }
      }

      // Done republishing
      await releaseLock(lockName);
    }
  });
}
