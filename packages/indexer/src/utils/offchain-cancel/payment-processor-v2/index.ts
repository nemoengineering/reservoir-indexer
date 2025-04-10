import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { verifyTypedData } from "@ethersproject/wallet";
import * as Sdk from "@reservoir0x/sdk";

import { idb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import { config } from "@/config/index";
import { Sources } from "@/models/sources";
import { cosigner, saveOffChainCancellations } from "@/utils/offchain-cancel";
import {
  ExternalTypedDataSigner,
  getExternalCosigner,
} from "@/utils/offchain-cancel/external-cosign";
import { redis } from "@/common/redis";
import { now } from "@/common/utils";

export const getOrderSource = async (id: string) => {
  const order = await idb.oneOrNone(
    "SELECT orders.source_id_int FROM orders WHERE orders.id = $/id/",
    { id }
  );

  const sources = await Sources.getInstance();
  const source = sources.get(order.source_id_int);

  return source;
};

// Reuse the cancellation format of `seaport` orders
export const generateOffChainCancellationSignatureData = async (orderIds: string[]) => {
  const orderSource = await getOrderSource(orderIds[0]);

  const domainName =
    orderSource && orderSource.metadata && orderSource.metadata.adminTitle
      ? orderSource.metadata.adminTitle
      : "Off-Chain Cancellation";

  return {
    signatureKind: "eip712",
    domain: {
      name: domainName,
      version: "1.0.0",
      chainId: config.chainId,
    },
    types: { OrderHashes: [{ name: "orderHashes", type: "bytes32[]" }] },
    value: {
      orderHashes: orderIds,
    },
    primaryType: "OrderHashes",
  };
};

const verifyOffChainCancellationSignature = async (
  orderIds: string[],
  signature: string,
  signer: string
) => {
  const message = await generateOffChainCancellationSignatureData(orderIds);

  // First, check for an eip155 (eoa) signature
  let isValidEIP155Signature = false;
  try {
    const recoveredSigner = verifyTypedData(
      message.domain,
      message.types,
      message.value,
      signature
    );
    isValidEIP155Signature = recoveredSigner.toLowerCase() === signer.toLowerCase();
  } catch {
    // Skip errors
  }

  // Secondly, check for an eip1271 (contract) signature
  let isValidEIP1271Signature = false;
  if (!isValidEIP155Signature) {
    try {
      const eip712Hash = _TypedDataEncoder.hash(message.domain, message.types, message.value);

      const iface = new Interface([
        "function isValidSignature(bytes32 digest, bytes signature) view returns (bytes4)",
      ]);

      const result = await new Contract(signer, iface, baseProvider).isValidSignature(
        eip712Hash,
        signature
      );
      isValidEIP1271Signature = result === iface.getSighash("isValidSignature");
    } catch {
      // Skip errors
    }
  }

  return isValidEIP155Signature || isValidEIP1271Signature;
};

export const doCancel = async ({
  orderIds,
  signature,
  maker,
}: {
  orderIds: string[];
  signature: string;
  maker: string;
}) => {
  const success = await verifyOffChainCancellationSignature(orderIds, signature, maker);
  if (!success) {
    throw new Error("Invalid signature");
  }

  // Save cancellations
  await saveOffChainCancellations(orderIds);
};

export const doSignOrder = async (
  order: Sdk.PaymentProcessorV2.Order | Sdk.PaymentProcessorV21.Order,
  taker: string,
  relayer?: string,
  skipOffChainCancellableIsFillableCheck?: boolean
) => {
  if (order.isCosignedOrder()) {
    const orderId = order.hash();

    const isOffChainCancelled = await idb.oneOrNone(
      `SELECT 1 FROM off_chain_cancellations WHERE order_id = $/orderId/`,
      { orderId }
    );
    if (isOffChainCancelled) {
      throw new Error("Order is off-chain cancelled");
    }

    if (!skipOffChainCancellableIsFillableCheck) {
      const isFillable = await idb.oneOrNone(
        `SELECT 1 FROM orders WHERE id = $/orderId/ AND orders.fillability_status = 'fillable' AND orders.approval_status = 'approved'`,
        { orderId }
      );
      if (!isFillable) {
        throw new Error("Order is not fillable");
      }
    }

    const consiger = order.params.cosigner!;
    const externalCosigner = await getExternalCosigner(consiger);
    if (externalCosigner) {
      await order.cosign(new ExternalTypedDataSigner(externalCosigner), relayer ?? taker);
    } else {
      await order.cosign(cosigner(), relayer ?? taker);
    }

    await redis.set(`cosigner-order:${orderId}`, now(), "EX", 90);
  }
};
