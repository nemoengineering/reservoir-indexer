import { ChainIdToAddress, resolveAddress } from "../utils";

export const OpenseaConduitKey: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OpenseaConduitKey"
);

export const ReservoirConduitKey: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ReservoirConduitKey"
);

export const MagicedenConduitKey: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "MagicedenConduitKey"
);

export const ConduitController: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ConduitController"
);

// https://github.com/ProjectOpenSea/seaport/blob/0a8e82ce7262b5ce0e67fa98a2131fd4c47c84e9/contracts/conduit/ConduitController.sol#L493
export const ConduitControllerCodeHash: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ConduitControllerCodeHash"
);

// This address is configured when the conduit address must be derived using zk based address derivation
export const ConduitControllerRuntimeCodeHash: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ConduitControllerRuntimeCodeHash"
);

export const OperatorFilterRegistry: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OperatorFilterRegistry"
);

// Zones

export const OpenSeaProtectedOffersZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OpenSeaProtectedOffersZone"
);

export const OpenSeaV16SignedZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OpenSeaV16SignedZone"
);

export const OpenSeaCustomTransferValidator: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OpenSeaCustomTransferValidator"
);

export const FxHashPausableZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "FxHashPausableZone"
);

export const ReservoirCancellationZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ReservoirCancellationZone"
);

export const ReservoirV16CancellationZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ReservoirV16CancellationZone"
);

export const ReservoirV16RoyaltyEnforcingZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "ReservoirV16RoyaltyEnforcingZone"
);

export const OkxCancellationZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OkxCancellationZone"
);

export const OkxV16CancellationZone: ChainIdToAddress = resolveAddress(
  "SeaportBase",
  "OkxV16CancellationZone"
);
