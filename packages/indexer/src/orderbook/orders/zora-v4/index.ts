import { BigNumberish } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";
import { keccak256 } from "@ethersproject/solidity";
import * as Sdk from "@reservoir0x/sdk";
import _ from "lodash";
import pLimit from "p-limit";

import { idb, pgp } from "@/common/db";
import { logger } from "@/common/logger";
import { baseProvider } from "@/common/provider";
import { bn, toBuffer } from "@/common/utils";
import { config } from "@/config/index";
import {
  OrderUpdatesByIdJobPayload,
  orderUpdatesByIdJob,
} from "@/jobs/order-updates/order-updates-by-id-job";
import { Sources } from "@/models/sources";
import { DbOrder, OrderMetadata, generateSchemaHash } from "@/orderbook/orders/utils";
import * as tokenSet from "@/orderbook/token-sets";
import * as zoraUtils from "@/utils/zora";
import * as royalties from "@/utils/royalties";

const POOL_ORDERS_MAX_PRICE_POINTS_COUNT = 20;
const SLIPPAGE = 10;

export type OrderInfo = {
  orderParams: {
    pool: string;
    // Validation parameters (for ensuring only the latest event is relevant)
    txHash: string;
    txTimestamp: number;
    txBlock: number;
    logIndex: number;
    tokenId: string;
    amount: number;
    // Misc options
    forceRecheck?: boolean;
  };
  metadata: OrderMetadata;
};

type SaveResult = {
  id: string;
  txHash: string;
  txTimestamp: number;
  status: string;
  triggerKind?: "new-order" | "reprice" | "cancel";
};

export const getOrderId = (pool: string, side: "sell" | "buy", tokenId: string) =>
  keccak256(["string", "address", "string", "uint256"], ["zora-v4", pool, side, tokenId]);

export const save = async (orderInfos: OrderInfo[]): Promise<SaveResult[]> => {
  const results: SaveResult[] = [];
  const orderValues: DbOrder[] = [];

  const handleOrder = async ({ orderParams }: OrderInfo) => {
    try {
      const market = await zoraUtils.getMarketDetails(orderParams.pool);
      if (!market) {
        // Return early if no market was found
        return;
      }

      // Force recheck at most once per hour
      const recheckCondition = orderParams.forceRecheck
        ? `AND orders.updated_at < to_timestamp(${orderParams.txTimestamp - 3600})`
        : `AND (orders.block_number, orders.log_index) < (${orderParams.txBlock}, ${orderParams.logIndex})`;

      // Handle orders
      for (const orderSide of ["buy", "sell"]) {
        try {
          const priceDirection = orderSide === "sell" ? "buy" : "sell";
          const id = getOrderId(orderParams.pool, orderSide as "buy" | "sell", market.tokenId);

          // We want to get the price for buying 1-20 items so we can calculate the price impact
          let tmpPriceList: ({ price: BigNumberish } | undefined)[] = Array.from(
            { length: POOL_ORDERS_MAX_PRICE_POINTS_COUNT },
            () => undefined
          );
          await Promise.all(
            _.range(0, POOL_ORDERS_MAX_PRICE_POINTS_COUNT).map(async (index) => {
              try {
                const poolPrice = await Sdk.ZoraV4.Helpers.getPoolQuote({
                  pool: orderParams.pool,
                  side: priceDirection,
                  quantity: index + 1,
                  provider: baseProvider,
                  slippage: SLIPPAGE,
                });
                tmpPriceList[index] = poolPrice;
              } catch {
                // Ignore errors
              }
            })
          );

          // Stop when the first `undefined` is encountered
          const firstUndefined = tmpPriceList.findIndex((p) => p === undefined);
          if (firstUndefined !== -1) {
            tmpPriceList = tmpPriceList.slice(0, firstUndefined);
          }
          const priceList = tmpPriceList.map((p) => p!);

          if (priceList.length) {
            // Get the price of buying this specific token id
            const { price } = await Sdk.ZoraV4.Helpers.getPoolQuote({
              pool: orderParams.pool,
              side: priceDirection,
              quantity: 1,
              slippage: SLIPPAGE,
              provider: baseProvider,
            });
            const value = bn(price).toString();

            // Get the price impact of buying 1-50 items
            const prices: string[] = [];
            for (let i = 0; i < priceList.length; i++) {
              prices.push(
                bn(priceList[i].price)
                  .sub(i > 0 ? priceList[i - 1].price : 0)
                  .toString()
              );
            }

            const feeBps = 0;
            const feeBreakdown: royalties.Royalty[] = [];

            // Handle: royalties on top
            const defaultRoyalties = await royalties.getRoyaltiesByTokenSet(
              `contract:${market.collection}`,
              "default"
            );

            const totalBuiltInBps = 0;
            const totalDefaultBps = defaultRoyalties
              .map(({ bps }) => bps)
              .reduce((a, b) => a + b, 0);

            const missingRoyalties = [];
            let missingRoyaltyAmount = bn(0);
            if (totalBuiltInBps < totalDefaultBps) {
              const validRecipients = defaultRoyalties.filter(
                ({ bps, recipient }) => bps && recipient !== AddressZero
              );
              if (validRecipients.length) {
                const bpsDiff = totalDefaultBps - totalBuiltInBps;
                const amount = bn(price).mul(bpsDiff).div(10000);
                missingRoyaltyAmount = missingRoyaltyAmount.add(amount);

                // Split the missing royalties pro-rata across all royalty recipients
                const totalBps = _.sumBy(validRecipients, ({ bps }) => bps);
                for (const { bps, recipient } of validRecipients) {
                  // TODO: Handle lost precision (by paying it to the last or first recipient)
                  missingRoyalties.push({
                    bps: Math.floor((bpsDiff * bps) / totalBps),
                    amount: amount.mul(bps).div(totalBps).toString(),
                    recipient,
                  });
                }
              }
            }

            const normalizedValue = bn(value).sub(missingRoyaltyAmount);

            // Handle: core sdk order
            const sdkOrder = new Sdk.ZoraV4.Order(config.chainId, {
              pool: orderParams.pool,
              side: priceDirection,
              collection: market.collection,
              tokenId: market.tokenId,
              price: price.toString(),
              extra: {
                prices,
              },
            });

            const orderResult = await idb.oneOrNone(
              `
                SELECT
                  orders.token_set_id
                FROM orders
                WHERE orders.id = $/id/
              `,
              { id }
            );
            if (!orderResult) {
              // Handle: token set
              const schemaHash = generateSchemaHash();
              const [{ id: tokenSetId }] = await tokenSet.singleToken.save([
                {
                  id: `token:${market.collection}:${market.tokenId}`,
                  schemaHash,
                  contract: market.collection,
                  tokenId: market.tokenId,
                },
              ]);

              if (!tokenSetId) {
                throw new Error("No token set available");
              }

              // Handle: source
              const sources = await Sources.getInstance();
              const source = await sources.getOrInsert("zora.co");

              const validFrom = `date_trunc('seconds', to_timestamp(${orderParams.txTimestamp}))`;
              const validTo = `'Infinity'`;

              orderValues.push({
                id,
                kind: "zora-v4",
                side: orderSide as "sell" | "buy",
                fillability_status: "fillable",
                approval_status: "approved",
                token_set_id: tokenSetId,
                token_set_schema_hash: toBuffer(schemaHash),
                maker: toBuffer(market.pool),
                taker: toBuffer(AddressZero),
                price: price.toString(),
                value,
                currency: toBuffer(Sdk.Common.Addresses.Native[config.chainId]),
                currency_price: price.toString(),
                currency_value: value,
                needs_conversion: null,
                quantity_remaining: prices.length.toString(),
                valid_between: `tstzrange(${validFrom}, ${validTo}, '[]')`,
                nonce: null,
                source_id_int: source?.id,
                is_reservoir: null,
                contract: toBuffer(market.collection),
                conduit: null,
                fee_bps: feeBps,
                fee_breakdown: feeBreakdown,
                dynamic: false,
                raw_data: sdkOrder.params,
                expiration: validTo,
                missing_royalties: missingRoyalties,
                normalized_value: normalizedValue.toString(),
                currency_normalized_value: normalizedValue.toString(),
                block_number: orderParams.txBlock ?? null,
                log_index: orderParams.logIndex ?? null,
              });

              results.push({
                id,
                txHash: orderParams.txHash,
                txTimestamp: orderParams.txTimestamp,
                status: "success",
                triggerKind: "new-order",
              });
            } else {
              const { rowCount } = await idb.result(
                `
                  UPDATE orders SET
                    fillability_status = 'fillable',
                    approval_status = 'approved',
                    price = $/price/,
                    currency_price = $/price/,
                    value = $/value/,
                    currency_value = $/value/,
                    quantity_remaining = $/quantityRemaining/,
                    valid_between = tstzrange(date_trunc('seconds', to_timestamp(${orderParams.txTimestamp})), 'Infinity', '[]'),
                    expiration = 'Infinity',
                    updated_at = now(),
                    raw_data = $/rawData:json/,
                    missing_royalties = $/missingRoyalties:json/,
                    normalized_value = $/normalizedValue/,
                    currency_normalized_value = $/currencyNormalizedValue/,
                    fee_bps = $/feeBps/,
                    fee_breakdown = $/feeBreakdown:json/,
                    currency = $/currency/,
                    block_number = $/blockNumber/,
                    log_index = $/logIndex/
                  WHERE orders.id = $/id/
                    ${recheckCondition}
                    AND (
                      orders.fillability_status != 'fillable'
                      OR orders.approval_status != 'approved'
                      OR orders.price IS DISTINCT FROM $/price/
                      OR orders.currency_price IS DISTINCT FROM $/price/
                      OR orders.value IS DISTINCT FROM $/value/
                      OR orders.currency_value IS DISTINCT FROM $/value/
                      OR orders.quantity_remaining IS DISTINCT FROM $/quantityRemaining/
                      OR orders.raw_data IS DISTINCT FROM $/rawData:json/
                      OR orders.missing_royalties IS DISTINCT FROM $/missingRoyalties:json/
                      OR orders.normalized_value IS DISTINCT FROM $/normalizedValue/
                      OR orders.currency_normalized_value IS DISTINCT FROM $/currencyNormalizedValue/
                      OR orders.fee_bps IS DISTINCT FROM $/feeBps/
                      OR orders.fee_breakdown IS DISTINCT FROM $/feeBreakdown:json/
                      OR orders.currency IS DISTINCT FROM $/currency/
                      OR orders.block_number IS DISTINCT FROM $/blockNumber/
                      OR orders.log_index IS DISTINCT FROM $/logIndex/
                    )
                `,
                {
                  id,
                  price: price.toString(),
                  value: value.toString(),
                  rawData: sdkOrder.params,
                  quantityRemaining: prices.length.toString(),
                  missingRoyalties: missingRoyalties,
                  normalizedValue: normalizedValue.toString(),
                  currencyNormalizedValue: normalizedValue.toString(),
                  feeBps,
                  feeBreakdown,
                  currency: toBuffer(Sdk.Common.Addresses.Native[config.chainId]),
                  blockNumber: orderParams.txBlock,
                  logIndex: orderParams.logIndex,
                }
              );

              if (rowCount !== 0) {
                results.push({
                  id,
                  txHash: orderParams.txHash,
                  txTimestamp: orderParams.txTimestamp,
                  status: "success",
                  triggerKind: "reprice",
                });
              }
            }
          } else {
            await idb.none(
              `
                UPDATE orders SET
                  fillability_status = 'no-balance',
                  expiration = to_timestamp(${orderParams.txTimestamp}),
                  block_number = $/blockNumber/,
                  log_index = $/logIndex/,
                  updated_at = now()
                WHERE orders.id = $/id/
                  ${recheckCondition}
              `,
              {
                id,
                blockNumber: orderParams.txBlock,
                logIndex: orderParams.logIndex,
              }
            );
            results.push({
              id,
              txHash: orderParams.txHash,
              txTimestamp: orderParams.txTimestamp,
              status: "success",
              triggerKind: "reprice",
            });
          }
        } catch (error) {
          logger.error(
            "orders-zora-v4-save",
            `Failed to handle ${orderSide} order with params ${JSON.stringify(
              orderParams
            )}: ${error}`
          );
        }
      }
    } catch (error) {
      logger.error(
        "orders-zora-v4-save",
        `Failed to handle order with params ${JSON.stringify(orderParams)}: ${error}`
      );
    }
  };

  // Process all orders concurrently
  const limit = pLimit(20);
  await Promise.all(orderInfos.map((orderInfo) => limit(() => handleOrder(orderInfo))));

  if (orderValues.length) {
    const columns = new pgp.helpers.ColumnSet(
      [
        "id",
        "kind",
        "side",
        "fillability_status",
        "approval_status",
        "token_set_id",
        "token_set_schema_hash",
        "maker",
        "taker",
        "price",
        "value",
        "currency",
        "currency_price",
        "currency_value",
        "needs_conversion",
        "quantity_remaining",
        { name: "valid_between", mod: ":raw" },
        "nonce",
        "source_id_int",
        "is_reservoir",
        "contract",
        "fee_bps",
        { name: "fee_breakdown", mod: ":json" },
        "dynamic",
        "raw_data",
        { name: "expiration", mod: ":raw" },
        { name: "missing_royalties", mod: ":json" },
        "normalized_value",
        "currency_normalized_value",
        "block_number",
        "log_index",
      ],
      {
        table: "orders",
      }
    );
    await idb.none(pgp.helpers.insert(orderValues, columns) + " ON CONFLICT DO NOTHING");
  }

  await orderUpdatesByIdJob.addToQueue(
    results
      .filter(({ status }) => status === "success")
      .map(
        ({ id, txHash, txTimestamp, triggerKind }) =>
          ({
            context: `${triggerKind}-${id}-${txHash}`,
            id,
            trigger: {
              kind: triggerKind,
              txHash: txHash,
              txTimestamp: txTimestamp,
            },
          } as OrderUpdatesByIdJobPayload)
      )
  );

  return results;
};
