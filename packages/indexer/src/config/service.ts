import { config } from "@/config/index";

export const getServiceName = () => {
  return `indexer-${config.version}-${config.chainName}`;
};
