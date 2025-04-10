import _ from "lodash";
import { alchemyMetadataProvider } from "./alchemy-metadata-provider";
import { raribleMetadataProvider } from "./rarible-metadata-provider";
import { openseaMetadataProvider } from "./opensea-metadata-provider";
import { onchainMetadataProvider } from "./onchain-metadata-provider";
import { zoraMetadataProvider } from "./zora-metadata-provider";
import { AbstractBaseMetadataProvider } from "./abstract-base-metadata-provider";

export const MetadataProviders: AbstractBaseMetadataProvider[] = [
  alchemyMetadataProvider,
  raribleMetadataProvider,
  openseaMetadataProvider,
  onchainMetadataProvider,
  zoraMetadataProvider,
];

export const MetadataProvidersMap = _.keyBy(MetadataProviders, "method");
