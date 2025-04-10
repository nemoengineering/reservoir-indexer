import { ChainIdToAddress, resolveAddress } from "../utils";

export const CollectionSettingsRegistry: ChainIdToAddress = resolveAddress(
  "PaymentProcessorBase",
  "CollectionSettingsRegistry"
);

export const TrustedForwarderFactory: ChainIdToAddress = resolveAddress(
  "PaymentProcessorBase",
  "TrustedForwarderFactory"
);

export const ReservoirTrustedForwarder: ChainIdToAddress = resolveAddress(
  "PaymentProcessorBase",
  "ReservoirTrustedForwarder"
);
