import { ItemCancelledEventPayload } from "@opensea/stream-js/dist/types";

import { openseaOffChainCancellationsJob } from "@/jobs/order-updates/misc/opensea-off-chain-cancellations-job";
import { getOpenseaChainName } from "@/config/network";
import _ from "lodash";

export const handleEvent = async (payload: ItemCancelledEventPayload) => {
  if (!_.isEmpty(payload.item) && getOpenseaChainName() != payload.item.chain.name) {
    return null;
  }

  await openseaOffChainCancellationsJob.addToQueue({ orderId: payload.order_hash });

  return null;
};
