import "@/jobs/index";
import "@/jobs/cdc/index";
import "@/config/polyfills";
import "@/websockets/index";

import _ from "lodash";

import { start } from "@/api/index";
import { logger } from "@/common/logger";
import { config } from "@/config/index";
import { getNetworkSettings } from "@/config/network";
import { startKafkaConsumer } from "@/jobs/cdc";
import { RabbitMqJobsConsumer } from "@/jobs/index";
import { FeeRecipients } from "@/models/fee-recipients";
import { Sources } from "@/models/sources";
import * as kafkaStreamProducer from "@/common/kafka-stream-producer";
import { AllChainsPubSub, PubSub } from "@/pubsub/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.on("unhandledRejection", (error: any) => {
  logger.error("process", `Unhandled rejection: ${error} (${error.stack})`);

  // For now, just skip any unhandled errors
  // process.exit(1);
});

const setup = async () => {
  logger.info(
    "setup",
    JSON.stringify({
      message: "Start.",
      localTesting: process.env.LOCAL_TESTING,
      doBackgroundWork: config.doBackgroundWork,
      doKafkaWork: config.doKafkaWork,
      doKafkaStreamWork: config.doKafkaStreamWork,
      doElasticsearchWork: config.doElasticsearchWork,
      forceEnableRabbitJobsConsumer: config.forceEnableRabbitJobsConsumer,
    })
  );

  if (Number(process.env.LOCAL_TESTING)) {
    return;
  }

  await PubSub.subscribe();
  await AllChainsPubSub.subscribe();

  if (config.doKafkaStreamWork) {
    await kafkaStreamProducer.start();
  }

  if (config.doBackgroundWork || config.forceEnableRabbitJobsConsumer) {
    const start = _.now();
    await RabbitMqJobsConsumer.startRabbitJobsConsumer();
    logger.info("rabbit-timing", `rabbit consuming started in ${_.now() - start}ms`);
  }

  if (config.doBackgroundWork) {
    await Sources.syncSources();
    await FeeRecipients.syncFeeRecipients();
    const networkSettings = getNetworkSettings();
    if (networkSettings.onStartup) {
      await networkSettings.onStartup();
    }
  }

  await Sources.getInstance();
  await Sources.forceDataReload();

  if (config.doKafkaWork) {
    await startKafkaConsumer();
  }
};

setup().then(() => start());
