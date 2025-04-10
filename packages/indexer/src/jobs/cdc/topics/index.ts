import { config } from "@/config/index";

import { KafkaEventHandler } from "./KafkaEventHandler";
import { IndexerFillEventsHandler } from "@/jobs/cdc/topics/indexer-fill-events";
import { IndexerTransferEventsHandler } from "@/jobs/cdc/topics/indexer-nft-transfer-events";
import { IndexerOrdersHandler } from "@/jobs/cdc/topics/indexer-orders";
import { IndexerTokensHandler } from "@/jobs/cdc/topics/indexer-tokens";
import { IndexerCollectionsHandler } from "@/jobs/cdc/topics/indexer-collections";
import { IndexerTokenAttributesHandler } from "@/jobs/cdc/topics/indexer-token-attributes";
import { IndexerErc721cConfigsHandler } from "@/jobs/cdc/topics/indexer-erc721c-configs";
import { IndexerErc721cOperatorWhitelistsHandler } from "@/jobs/cdc/topics/indexer-erc721c-operator-whitelists";
import { IndexerErc721cPermittedContractReceiverAllowlistsHandler } from "@/jobs/cdc/topics/indexer-erc721c-permitted-contract-receiver-allowlists";
import { IndexerErc721cV2ConfigsHandler } from "@/jobs/cdc/topics/indexer-erc721c-v2-configs";
import { IndexerErc721cV2ListsHandler } from "@/jobs/cdc/topics/indexer-erc721c-v2-lists";
import { IndexerErc721cV3ConfigsHandler } from "@/jobs/cdc/topics/indexer-erc721c-v3-configs";
import { IndexerErc721cV3ListsHandler } from "@/jobs/cdc/topics/indexer-erc721c-v3-lists";
import { IndexerFtTransferEventsHandler } from "@/jobs/cdc/topics/indexer-ft-transfer-events";
import { IndexerTransactionsHandler } from "@/jobs/cdc/topics/indexer-transactions";
import { IndexerCurrenciesHandler } from "@/jobs/cdc/topics/indexer-currencies";

export const TopicHandlers: KafkaEventHandler[] = [
  new IndexerOrdersHandler(),
  new IndexerTransferEventsHandler(),
  new IndexerFillEventsHandler(),
  new IndexerTokensHandler(),
  new IndexerCollectionsHandler(),
  new IndexerTokenAttributesHandler(),
  new IndexerErc721cConfigsHandler(),
  new IndexerErc721cOperatorWhitelistsHandler(),
  new IndexerErc721cPermittedContractReceiverAllowlistsHandler(),
  new IndexerErc721cV2ConfigsHandler(),
  new IndexerErc721cV2ListsHandler(),
  new IndexerErc721cV3ConfigsHandler(),
  new IndexerErc721cV3ListsHandler(),
];

if (config.enableElasticsearchFtActivities || config.enableElasticsearchCurrencies) {
  TopicHandlers.push(new IndexerFtTransferEventsHandler());

  if (config.enableElasticsearchFtActivities) {
    TopicHandlers.push(new IndexerTransactionsHandler());
  }

  if (config.enableElasticsearchCurrencies) {
    TopicHandlers.push(new IndexerCurrenciesHandler());
  }
}
