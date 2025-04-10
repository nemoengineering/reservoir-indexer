import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { BytesLike, splitSignature } from "@ethersproject/bytes";
import { AddressZero } from "@ethersproject/constants";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { pack } from "@ethersproject/solidity";

import { ReservoirV16RoyaltyEnforcingZone } from "./addresses";
import { IOrder } from "./order";
import { MatchParams, ReceivedItem } from "./types";
import { TransferValidatorV3 } from "../erc721c/addresses";
import { bn, getCurrentTimestamp } from "../utils";

export const CONSIDERATION_EIP712_TYPE = {
  Consideration: [{ name: "consideration", type: "ReceivedItem[]" }],
  ReceivedItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifier", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
};

export const SIGNED_ORDER_EIP712_TYPE = {
  SignedOrder: [
    { name: "fulfiller", type: "address" },
    { name: "expiration", type: "uint64" },
    { name: "orderHash", type: "bytes32" },
    { name: "context", type: "bytes" },
  ],
};

export const EIP712_DOMAIN = (chainId: number, zone: string) => {
  if (zone === ReservoirV16RoyaltyEnforcingZone[chainId]) {
    return {
      name: "RoyaltyEnforcement",
      version: "2.0",
      chainId,
      verifyingContract: zone,
    };
  } else {
    return {
      name: "SignedZone",
      version: "1.0.0",
      chainId,
      verifyingContract: zone,
    };
  }
};

const encodeContext = (contextVersion: number, contextPayload: BytesLike) =>
  pack(["bytes1", "bytes"], [contextVersion, contextPayload]);

export const computeReceivedItems = (order: IOrder, matchParams: MatchParams): ReceivedItem[] => {
  return order.params.consideration.map((c) => ({
    ...c,
    // All criteria items should have been resolved
    itemType: c.itemType > 3 ? c.itemType - 2 : c.itemType,
    // Adjust the amount to the quantity filled (won't work for dutch auctions)
    amount: bn(matchParams!.amount ?? 1)
      .mul(c.endAmount)
      .div(order.getInfo()!.amount)
      .toString(),
    identifier:
      c.itemType > 3 ? matchParams!.criteriaResolvers![0].identifier : c.identifierOrCriteria,
  }));
};

export const signOrder = async (
  chainId: number,
  cosigner: TypedDataSigner,
  fulfiller: string,
  expiration: number,
  orderHash: string,
  context: BytesLike,
  zone: string
) =>
  cosigner._signTypedData(EIP712_DOMAIN(chainId, zone), SIGNED_ORDER_EIP712_TYPE, {
    fulfiller,
    expiration,
    orderHash,
    context,
  });

export const convertSignatureToEIP2098 = (signature: string) => {
  if (signature.length === 130) {
    return signature;
  }

  if (signature.length !== 132) {
    throw Error("invalid signature length (must be 64 or 65 bytes)");
  }

  return splitSignature(signature).compact;
};

export const hashConsideration = (consideration: ReceivedItem[]) =>
  _TypedDataEncoder.hashStruct("Consideration", CONSIDERATION_EIP712_TYPE, {
    consideration,
  });

const encodeExtraData = async (
  chainId: number,
  cosigner: TypedDataSigner,
  fulfiller: string,
  expiration: number,
  orderHash: string,
  consideration: ReceivedItem[],
  zone: string,
  transferValidator?: string
) => {
  let context: string;
  if ([ReservoirV16RoyaltyEnforcingZone[chainId]].includes(zone)) {
    // We're using substandard 9:
    // https://github.com/ProjectOpenSea/SIPs/blob/main/SIPS/sip-7.md#substandards
    context = encodeContext(
      9,
      pack(
        ["uint256", "address"],
        [consideration[0].identifier, transferValidator ?? TransferValidatorV3[chainId]]
      )
    );
  } else {
    // No standard being used here
    context = encodeContext(0, hashConsideration(consideration));
  }

  const signature = await signOrder(
    chainId,
    cosigner,
    fulfiller,
    expiration,
    orderHash,
    context,
    zone
  );
  return pack(
    ["bytes1", "address", "uint64", "bytes", "bytes"],
    [0, fulfiller, expiration, convertSignatureToEIP2098(signature), context]
  );
};

export const cosignOrder = async (
  order: IOrder,
  cosigner: TypedDataSigner,
  _taker: string,
  matchParams: MatchParams,
  zone: string,
  transferValidator?: string
) => {
  const orderHash = order.hash();
  const consideration = computeReceivedItems(order, matchParams);
  const expiration = getCurrentTimestamp(90);

  return encodeExtraData(
    order.chainId,
    cosigner,
    AddressZero,
    expiration,
    orderHash,
    consideration,
    zone,
    transferValidator
  );
};
