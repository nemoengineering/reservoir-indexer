import { config } from "@/config/index";
import { Client } from "@elastic/elasticsearch";
import { logger } from "@/common/logger";

let elasticsearch: Client;
let elasticsearchActivities: Client;
let elasticsearchAsks: Client;
let elasticsearchCollections: Client;
let elasticsearchTokens: Client;
let elasticsearchCurrencies: Client;

if (config.elasticsearchUrl) {
  logger.info(
    "elasticsearch",
    JSON.stringify({
      topic: "initClient",
      message: "Init.",
      elasticsearchUrl: config.elasticsearchUrl,
      elasticsearchUsername: config.elasticsearchUsername,
      elasticsearchPassword: config.elasticsearchPassword,
    })
  );

  elasticsearch = new Client({
    node: config.elasticsearchUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchUsername && config.elasticsearchPassword
      ? {
          auth: {
            username: config.elasticsearchUsername,
            password: config.elasticsearchPassword,
          },
        }
      : {}),
  });

  elasticsearchActivities = elasticsearch;
  elasticsearchAsks = elasticsearch;
  elasticsearchCollections = elasticsearch;
  elasticsearchTokens = elasticsearch;
  elasticsearchCurrencies = elasticsearch;
}

if (config.elasticsearchActivitiesUrl) {
  logger.info(
    "elasticsearch-activities",
    JSON.stringify({
      topic: "initClient",
      message: "Start.",
      elasticsearchActivitiesUrl: config.elasticsearchActivitiesUrl,
    })
  );

  elasticsearchActivities = new Client({
    node: config.elasticsearchActivitiesUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchActivitiesUsername && config.elasticsearchActivitiesPassword
      ? {
          auth: {
            username: config.elasticsearchActivitiesUsername,
            password: config.elasticsearchActivitiesPassword,
          },
        }
      : {}),
  });
}

if (config.elasticsearchAsksUrl) {
  logger.info(
    "elasticsearch-asks",
    JSON.stringify({
      topic: "initClient",
      message: "Start.",
      elasticsearchAsksUrl: config.elasticsearchAsksUrl,
    })
  );

  elasticsearchAsks = new Client({
    node: config.elasticsearchAsksUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchAsksUsername && config.elasticsearchAsksPassword
      ? {
          auth: {
            username: config.elasticsearchAsksUsername,
            password: config.elasticsearchAsksPassword,
          },
        }
      : {}),
  });
}

if (config.elasticsearchCollectionsUrl) {
  logger.info(
    "elasticsearch-collections",
    JSON.stringify({
      topic: "initClient",
      message: "Start.",
      elasticsearchCollectionsUrl: config.elasticsearchCollectionsUrl,
    })
  );

  elasticsearchCollections = new Client({
    node: config.elasticsearchCollectionsUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchCollectionsUsername && config.elasticsearchCollectionsPassword
      ? {
          auth: {
            username: config.elasticsearchCollectionsUsername,
            password: config.elasticsearchCollectionsPassword,
          },
        }
      : {}),
  });
}

if (config.elasticsearchTokensUrl) {
  logger.info(
    "elasticsearch-tokens",
    JSON.stringify({
      topic: "initClient",
      message: "Start.",
      elasticsearchTokensUrl: config.elasticsearchTokensUrl,
    })
  );

  elasticsearchTokens = new Client({
    node: config.elasticsearchTokensUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchTokensUsername && config.elasticsearchTokensPassword
      ? {
          auth: {
            username: config.elasticsearchTokensUsername,
            password: config.elasticsearchTokensPassword,
          },
        }
      : {}),
  });
}

if (config.elasticsearchCurrenciesUrl) {
  logger.info(
    "elasticsearch-currencies",
    JSON.stringify({
      topic: "initClient",
      message: "Start.",
      elasticsearchCurrenciesUrl: config.elasticsearchCurrenciesUrl,
    })
  );

  elasticsearchCurrencies = new Client({
    node: config.elasticsearchCurrenciesUrl,
    requestTimeout: 10000,
    ...(config.elasticsearchCurrenciesUsername && config.elasticsearchCurrenciesPassword
      ? {
          auth: {
            username: config.elasticsearchCurrenciesUsername,
            password: config.elasticsearchCurrenciesPassword,
          },
        }
      : {}),
  });
}

export {
  elasticsearch,
  elasticsearchActivities,
  elasticsearchAsks,
  elasticsearchCollections,
  elasticsearchTokens,
  elasticsearchCurrencies,
};
