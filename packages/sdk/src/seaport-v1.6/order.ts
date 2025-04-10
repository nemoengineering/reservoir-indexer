import { TypedDataSigner } from "@ethersproject/abstract-signer";

import { Exchange } from "./exchange";
import * as Addresses from "../seaport-base/addresses";
import { cosignOrder } from "../seaport-base/helpers";
import * as Types from "../seaport-base/types";
import { Order as OrderV15 } from "../seaport-v1.5/order";

export class Order extends OrderV15 {
  constructor(chainId: number, params: Types.OrderComponents) {
    super(chainId, params);
  }

  // Overrides

  public exchange() {
    return new Exchange(this.chainId);
  }

  public async cosign(
    signer: TypedDataSigner,
    taker: string,
    matchParams: Types.MatchParams,
    zone: string,
    transferValidator?: string
  ) {
    if (
      ![
        Addresses.ReservoirV16CancellationZone[this.chainId],
        Addresses.ReservoirV16RoyaltyEnforcingZone[this.chainId],
      ].includes(zone)
    ) {
      throw new Error("Unsupported zone");
    }

    this.params.extraData = await cosignOrder(
      this,
      signer,
      taker,
      matchParams,
      zone,
      transferValidator
    );
  }
}
