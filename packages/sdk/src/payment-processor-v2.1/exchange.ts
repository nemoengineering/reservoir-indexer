import { Interface, defaultAbiCoder } from "@ethersproject/abi";
import { Provider } from "@ethersproject/abstract-provider";
import { Signer, TypedDataSigner } from "@ethersproject/abstract-signer";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { splitSignature } from "@ethersproject/bytes";
import { AddressZero } from "@ethersproject/constants";
import { Contract, ContractTransaction } from "@ethersproject/contracts";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { keccak256 } from "@ethersproject/keccak256";
import { MerkleTree } from "merkletreejs";

import * as Addresses from "./addresses";
import { EIP712_DOMAIN, Order } from "./order";
import * as Types from "./types";
import { MatchingOptions } from "../payment-processor-v2/builders/base";
import { TxData, bn, generateSourceBytes } from "../utils";

import ExchangeAbi from "./abis/Exchange.json";

export class Exchange {
  public chainId: number;
  public contract: Contract;
  public domainSeparator: string;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.contract = new Contract(Addresses.Exchange[chainId], ExchangeAbi);
    this.domainSeparator = this.buildDomainSeparator();
  }

  private buildDomainSeparator() {
    const domain = EIP712_DOMAIN(this.chainId);
    return _TypedDataEncoder.hashDomain(domain);
  }

  // --- Get master nonce ---

  public async getMasterNonce(provider: Provider, user: string): Promise<BigNumber> {
    return this.contract.connect(provider).masterNonces(user);
  }

  // --- Cancel order ---

  public async cancelOrder(maker: Signer, order: Order): Promise<ContractTransaction> {
    const tx = this.cancelOrderTx(await maker.getAddress(), order);
    return maker.sendTransaction(tx);
  }

  public cancelOrderTx(maker: string, order: Order): TxData {
    return {
      from: maker,
      to: this.contract.address,
      data: this.contract.interface.encodeFunctionData("revokeSingleNonce", [
        defaultAbiCoder.encode(["uint256"], [order.params.nonce]),
      ]),
    };
  }

  // --- Increase master nonce ---

  public async revokeMasterNonce(maker: Signer): Promise<ContractTransaction> {
    const tx = this.revokeMasterNonceTx(await maker.getAddress());
    return maker.sendTransaction(tx);
  }

  public revokeMasterNonceTx(maker: string): TxData {
    const data: string = this.contract.interface.encodeFunctionData("revokeMasterNonce", []);
    return {
      from: maker,
      to: this.contract.address,
      data,
    };
  }

  // --- Fill single order ---

  public async fillOrder(
    taker: Signer,
    order: Order,
    matchOptions: MatchingOptions,
    options?: {
      trustedChannel?: string;
      source?: string;
      relayer?: string;
      fee?: {
        recipient: string;
        amount: BigNumberish;
      };
    }
  ): Promise<ContractTransaction> {
    const tx = this.fillOrderTx(await taker.getAddress(), order, matchOptions, options);
    return taker.sendTransaction(tx);
  }

  public fillOrderTx(
    taker: string,
    order: Order,
    matchOptions: MatchingOptions,
    options?: {
      trustedChannel?: string;
      source?: string;
      relayer?: string;
      fee?: {
        recipient: string;
        amount: BigNumberish;
      };
    }
  ): TxData {
    const feeOnTop = options?.fee ?? {
      recipient: AddressZero,
      amount: bn(0),
    };

    const sender = options?.relayer ?? taker;
    const matchedOrder = order.buildMatching(matchOptions);
    const isCollectionLevelOffer = order.isCollectionLevelOffer();

    const isBuyOrder = order.isBuyOrder();
    const isAdvancedOrder = order.isBulkOrder();

    const iface = this.contract.interface;

    let data: string;
    if (isBuyOrder) {
      if (isAdvancedOrder) {
        data = iface.encodeFunctionData("acceptOfferAdvanced", [
          defaultAbiCoder.encode(
            [
              `${Types.AdvancedBidOrder} advancedBid`,
              `(uint256 orderIndex, bytes32[] proof) bulkOrderProof`,
              `(address recipient, uint256 amount) feeOnTop`,
              `(bytes32 rootHash, bytes32[] proof) tokenSetProof`,
            ],
            [
              {
                isCollectionLevelOffer,
                advancedOrder: {
                  saleDetails: matchedOrder,
                  signature: matchedOrder.signature,
                  cosignature: order.getCosignature(),
                  permitContext: order.getPermitContext(),
                },
                sellerPermitSignature: order.getSellerPermitSignature(),
              },
              order.params.bulkOrderProof,
              feeOnTop,
              order.getTokenSetProof(),
            ]
          ),
        ]);
      } else {
        data = iface.encodeFunctionData("acceptOffer", [
          defaultAbiCoder.encode(
            [
              "bool isCollectionLevelOffer",
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              ) saleDetails`,
              "(uint256 v, bytes32 r, bytes32 s) signature",
              "(bytes32 rootHash, bytes32[] proof) tokenSetProof",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature",
              "(address recipient, uint256 amount) feeOnTop",
            ],
            [
              isCollectionLevelOffer,
              matchedOrder,
              matchedOrder.signature,
              order.getTokenSetProof(),
              order.getCosignature(),
              feeOnTop,
            ]
          ),
        ]);
      }
    } else {
      if (isAdvancedOrder) {
        data = iface.encodeFunctionData("buyListingAdvanced", [
          defaultAbiCoder.encode(
            [
              `${Types.AdvancedOrder} advancedListing`,
              "(uint256 orderIndex, bytes32[] proof) bulkOrderProof",
              "(address recipient, uint256 amount) feeOnTop",
            ],
            [
              {
                saleDetails: matchedOrder,
                signature: matchedOrder.signature,
                cosignature: order.getCosignature(),
                permitContext: order.getPermitContext(),
              },
              order.params.bulkOrderProof,
              feeOnTop,
            ]
          ),
        ]);
      } else {
        data = iface.encodeFunctionData("buyListing", [
          defaultAbiCoder.encode(
            [
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              ) saleDetails`,
              "(uint256 v, bytes32 r, bytes32 s) signature",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature",
              "(address recipient, uint256 amount) feeOnTop",
            ],
            [matchedOrder, matchedOrder.signature, order.getCosignature(), feeOnTop]
          ),
        ]);
      }
    }

    const passValue =
      !order.isBuyOrder() &&
      order.params.sellerOrBuyer != taker.toLowerCase() &&
      matchedOrder.paymentMethod === AddressZero;

    const fillAmount = matchOptions.amount ?? 1;
    const fillValue = bn(order.params.itemPrice)
      .div(order.params.amount)
      .mul(bn(fillAmount))
      .add(feeOnTop.amount);

    let tx: TxData = {
      from: sender,
      to: this.contract.address,
      value: passValue ? fillValue.toString() : "0",
      data,
    };

    if (options?.trustedChannel) {
      tx = this.forwardCallTx(tx, options?.trustedChannel, options);
    }

    return tx;
  }

  // --- Fill multiple orders ---

  public fillOrdersTx(
    taker: string,
    orders: Order[],
    matchOptions: MatchingOptions[],
    options?: {
      trustedChannel?: string;
      source?: string;
      relayer?: string;
      fees?: {
        recipient: string;
        amount: BigNumberish;
      }[];
    }
  ): TxData {
    if (orders.length === 1) {
      return this.fillOrderTx(taker, orders[0], matchOptions[0], {
        trustedChannel: options?.trustedChannel,
        source: options?.source,
        fee: options?.fees?.length ? options.fees[0] : undefined,
      });
    }

    const sender = options?.relayer ?? taker;

    const allFees: {
      recipient: string;
      amount: BigNumberish;
    }[] = [];

    let price = bn(0);

    let tx: TxData;

    const isBuyOrder = orders[0].isBuyOrder();
    const isBulkOrder = orders.some((c) => c.isBulkOrder());

    if (isBuyOrder) {
      const saleDetails = orders.map((order, i) => {
        const matchedOrder = order.buildMatching(matchOptions[i]);
        const associatedFee =
          options?.fees && options.fees[i]
            ? options.fees[i]
            : {
                recipient: AddressZero,
                amount: bn(0),
              };

        allFees.push(associatedFee);

        return matchedOrder;
      });

      if (isBulkOrder) {
        const data = this.contract.interface.encodeFunctionData("bulkAcceptOffersAdvanced", [
          defaultAbiCoder.encode(
            [
              `${Types.AdvancedBidOrder}[] advancedBidsArray`,
              `(uint256 orderIndex, bytes32[] proof)[] bulkOrderProofs`,
              `(address recipient, uint256 amount)[] feesOnTop`,
              `(bytes32 rootHash, bytes32[] proof)[] tokenSetProofs`,
            ],
            [
              saleDetails.map((saleDetail, i) => {
                const order = orders[i];
                return {
                  isCollectionLevelOffer: order.params.kind === "collection-offer-approval",
                  advancedOrder: {
                    saleDetails: saleDetail,
                    signature: saleDetail.signature,
                    cosignature: order.getCosignature(),
                    permitContext: order.getPermitContext(),
                  },
                  sellerPermitSignature: order.getSellerPermitSignature(),
                };
              }),
              orders.map((c) => c.params.bulkOrderProof),
              allFees,
              orders.map((c) => c.getTokenSetProof()),
            ]
          ),
        ]);

        tx = {
          from: sender,
          to: this.contract.address,
          data,
          gas: String(200000 + 175000 * orders.length),
        };
      } else {
        const data = this.contract.interface.encodeFunctionData("bulkAcceptOffers", [
          defaultAbiCoder.encode(
            [
              `
                (
                  bool isCollectionLevelOffer,
                  (
                    uint256 protocol,
                    address maker,
                    address beneficiary,
                    address marketplace,
                    address fallbackRoyaltyRecipient,
                    address paymentMethod,
                    address tokenAddress,
                    uint256 tokenId,
                    uint256 amount,
                    uint256 itemPrice,
                    uint256 nonce,
                    uint256 expiration,
                    uint256 marketplaceFeeNumerator,
                    uint256 maxRoyaltyFeeNumerator,
                    uint256 requestedFillAmount,
                    uint256 minimumFillAmount
                  ) saleDetails,
                  (uint256 v, bytes32 r, bytes32 s) signature,
                  (address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s) cosignature
                )[] params
              `,
              "(address recipient, uint256 amount)[] feesOnTop",
              "(bytes32 rootHash, bytes32[] proof)[] tokenSetProofs",
            ],
            [
              saleDetails.map((saleDetails, i) => ({
                isCollectionLevelOffer: orders[i].params.kind === "collection-offer-approval",
                saleDetails,
                signature: saleDetails.signature,
                cosignature: orders[i].getCosignature(),
              })),
              allFees,
              orders.map((c) => c.getTokenSetProof()),
            ]
          ),
        ]);

        tx = {
          from: sender,
          to: this.contract.address,
          data,
          gas: String(200000 + 175000 * orders.length),
        };
      }
    } else {
      const saleDetails = orders.map((order, i) => {
        const matchedOrder = order.buildMatching(matchOptions[i]);

        const associatedFee =
          options?.fees && options.fees[i]
            ? options.fees[i]
            : {
                recipient: AddressZero,
                amount: bn(0),
              };

        const fillAmount = matchOptions[i].amount ?? 1;
        const fillValue = bn(order.params.itemPrice)
          .div(order.params.amount)
          .mul(bn(fillAmount))
          .add(associatedFee.amount);

        const passValue =
          !order.isBuyOrder() &&
          order.params.sellerOrBuyer != taker.toLowerCase() &&
          matchedOrder.paymentMethod === AddressZero;
        if (passValue) {
          price = price.add(fillValue);
        }

        allFees.push(associatedFee);

        return matchedOrder;
      });

      if (!isBulkOrder) {
        const data = this.contract.interface.encodeFunctionData("bulkBuyListings", [
          defaultAbiCoder.encode(
            [
              `(
                uint256 protocol,
                address maker,
                address beneficiary,
                address marketplace,
                address fallbackRoyaltyRecipient,
                address paymentMethod,
                address tokenAddress,
                uint256 tokenId,
                uint256 amount,
                uint256 itemPrice,
                uint256 nonce,
                uint256 expiration,
                uint256 marketplaceFeeNumerator,
                uint256 maxRoyaltyFeeNumerator,
                uint256 requestedFillAmount,
                uint256 minimumFillAmount
              )[]`,
              "(uint256 v, bytes32 r, bytes32 s)[]",
              "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s)[]",
              "(address recipient, uint256 amount)[]",
            ],
            [
              saleDetails,
              saleDetails.map((c) => c.signature),
              orders.map((c) => c.getCosignature()),
              allFees,
            ]
          ),
        ]);

        tx = {
          from: sender,
          to: this.contract.address,
          value: price.toString(),
          data,
          gas: String(200000 + 175000 * orders.length),
        };
      } else {
        const data = this.contract.interface.encodeFunctionData("bulkBuyListingsAdvanced", [
          defaultAbiCoder.encode(
            [
              `${Types.AdvancedOrder}[] advancedListingsArray`,
              `(uint256 orderIndex, bytes32[] proof)[] bulkOrderProofs`,
              `(address recipient, uint256 amount)[] feesOnTop`,
            ],
            [
              saleDetails.map((matchedOrder, i) => {
                const order = orders[i];
                return {
                  saleDetails: matchedOrder,
                  signature: matchedOrder.signature,
                  cosignature: order.getCosignature(),
                  permitContext: order.getPermitContext(),
                };
              }),
              orders.map((c) => c.params.bulkOrderProof),
              allFees,
            ]
          ),
        ]);

        tx = {
          from: sender,
          to: this.contract.address,
          value: price.toString(),
          data,
          gas: String(200000 + 175000 * orders.length),
        };
      }
    }

    if (options?.trustedChannel) {
      tx = this.forwardCallTx(tx, options?.trustedChannel, options);
    }

    return tx;
  }

  // --- Fill multiple listings from the same collection ---

  public sweepCollectionTx(
    taker: string,
    orders: Order[],
    options?: {
      trustedChannel?: string;
      source?: string;
      relayer?: string;
      fee?: {
        recipient: string;
        amount: BigNumberish;
      };
    }
  ): TxData {
    const feeOnTop = options?.fee ?? {
      recipient: AddressZero,
      amount: bn(0),
    };

    const sender = options?.relayer ?? taker;

    let price = bn(0);
    orders.forEach((order) => {
      const passValue = order.params.paymentMethod === AddressZero;
      if (passValue) {
        price = price.add(order.params.itemPrice);
      }
    });

    const hasBulkOrder = orders.some((c) => c.isBulkOrder());
    let data: string;

    if (!hasBulkOrder) {
      const sweepCollectionParams = this.getSweepOrderParams(taker, orders);
      data = this.contract.interface.encodeFunctionData("sweepCollection", [
        defaultAbiCoder.encode(
          [
            "(address recipient, uint256 amount)",
            "(uint256 protocol, address tokenAddress, address paymentMethod, address beneficiary)",
            `(
              address maker,
              address marketplace,
              address fallbackRoyaltyRecipient,
              uint256 tokenId,
              uint256 amount,
              uint256 itemPrice,
              uint256 nonce,
              uint256 expiration,
              uint256 marketplaceFeeNumerator,
              uint256 maxRoyaltyFeeNumerator
            )[]`,
            "(uint256 v, bytes32 r, bytes32 s)[]",
            "(address signer, address taker, uint256 expiration, uint256 v, bytes32 r, bytes32 s)[]",
          ],
          [
            feeOnTop,
            sweepCollectionParams.sweepOrder,
            sweepCollectionParams.items,
            sweepCollectionParams.signedSellOrders,
            sweepCollectionParams.cosignatures,
          ]
        ),
      ]);
    } else {
      const sweepCollectionParams = this.getAdvancedSweepOrderParams(taker, orders);
      data = this.contract.interface.encodeFunctionData("sweepCollectionAdvanced", [
        defaultAbiCoder.encode(
          [
            `
            (
              (
                address recipient,
                uint256 amount
              ) feeOnTop,
              (
                uint256 protocol,
                address tokenAddress,
                address paymentMethod, 
                address beneficiary
              ) sweepOrder,
              (
                (
                  address maker,
                  address marketplace,
                  address fallbackRoyaltyRecipient,
                  uint256 tokenId,
                  uint256 amount,
                  uint256 itemPrice,
                  uint256 nonce,
                  uint256 expiration,
                  uint256 marketplaceFeeNumerator,
                  uint256 maxRoyaltyFeeNumerator
                ) sweepItem,
                ( 
                  uint256 v, 
                  bytes32 r,
                  bytes32 s
                ) signature,
                (
                  address signer,
                  address taker,
                  uint256 expiration,
                  uint256 v,
                  bytes32 r, 
                  bytes32 s
                ) cosignature,
                (
                  address permitProcessor,
                  uint256 permitNonce,
                ) permitContext,
                (
                  uint256 orderIndex,
                  bytes32[] proof
                ) bulkOrderProof,
              ) items
            )
            `,
          ],
          [
            {
              feeOnTop,
              sweepOrder: sweepCollectionParams.sweepOrder,
              items: sweepCollectionParams.items,
            },
          ]
        ),
      ]);
    }

    let tx: TxData = {
      from: sender,
      to: this.contract.address,
      value: price.toString(),
      data,
      gas: String(200000 + 175000 * orders.length),
    };

    if (options?.trustedChannel) {
      tx = this.forwardCallTx(tx, options?.trustedChannel, options);
    }

    return tx;
  }

  // --- Wrap tx data via a trusted channel forwarder ---

  public forwardCallTx(tx: TxData, channel: string, options?: { source?: string }) {
    return {
      ...tx,
      to: channel,
      data:
        new Interface([
          "function forwardCall(address target, bytes calldata message) external payable",
        ]).encodeFunctionData("forwardCall", [tx.to, tx.data]) +
        generateSourceBytes(options?.source),
    };
  }

  // --- Get parameters for sweeping multiple orders from the same collection ---

  public getSweepOrderParams(taker: string, orders: Order[]): Types.SweepOrderParams {
    const firstOrder = orders[0];
    const matchedOrder = firstOrder.buildMatching({
      taker,
    });

    return {
      sweepOrder: {
        protocol: matchedOrder.protocol,
        tokenAddress: matchedOrder.tokenAddress,
        paymentMethod: matchedOrder.paymentMethod,
        beneficiary: matchedOrder.beneficiary!,
      },
      items: orders.map(({ params: sellOrder }) => ({
        maker: sellOrder.sellerOrBuyer,
        marketplace: sellOrder.marketplace,
        tokenId: sellOrder.tokenId ?? "0",
        fallbackRoyaltyRecipient: sellOrder.fallbackRoyaltyRecipient ?? AddressZero,
        amount: sellOrder.amount,
        itemPrice: sellOrder.itemPrice,
        nonce: sellOrder.nonce,
        expiration: sellOrder.expiration,
        marketplaceFeeNumerator: sellOrder.marketplaceFeeNumerator,
        maxRoyaltyFeeNumerator: sellOrder.maxRoyaltyFeeNumerator ?? "0",
      })),
      signedSellOrders: orders.map((c) => {
        return {
          r: c.params.r!,
          s: c.params.s!,
          v: c.params.v!,
        };
      }),
      cosignatures: orders.map((c) => c.getCosignature()),
    };
  }

  public getAdvancedSweepOrderParams(taker: string, orders: Order[]) {
    const firstOrder = orders[0];
    const matchedOrder = firstOrder.buildMatching({
      taker,
    });
    return {
      sweepOrder: {
        protocol: matchedOrder.protocol,
        tokenAddress: matchedOrder.tokenAddress,
        paymentMethod: matchedOrder.paymentMethod,
        beneficiary: matchedOrder.beneficiary!,
      },
      items: orders.map((order) => {
        const sellOrder = order.params;
        return {
          signature: {
            r: order.params.r!,
            s: order.params.s!,
            v: order.params.v!,
          },
          cosignature: order.getCosignature(),
          permitContext: order.getPermitContext(),
          bulkOrderProof: sellOrder.bulkOrderProof,
          sweepItem: {
            maker: sellOrder.sellerOrBuyer,
            marketplace: sellOrder.marketplace,
            tokenId: sellOrder.tokenId ?? "0",
            fallbackRoyaltyRecipient: sellOrder.fallbackRoyaltyRecipient ?? AddressZero,
            amount: sellOrder.amount,
            itemPrice: sellOrder.itemPrice,
            nonce: sellOrder.nonce,
            expiration: sellOrder.expiration,
            marketplaceFeeNumerator: sellOrder.marketplaceFeeNumerator,
            maxRoyaltyFeeNumerator: sellOrder.maxRoyaltyFeeNumerator ?? "0",
          },
        };
      }),
    };
  }

  public encodeBulkSignature(signature: string, proof: Types.BulkOrderProof) {
    const { r, s, v } = splitSignature(signature);
    return {
      r,
      s,
      v,
      bulkOrderProof: proof,
    };
  }

  async bulkSign(signer: TypedDataSigner, orders: Order[]) {
    const { signatureData, proofs } = this.getBulkSignatureDataWithProofs(orders);
    const signature = await signer._signTypedData(
      signatureData.domain,
      signatureData.types,
      signatureData.value
    );
    orders.forEach((order, i) => {
      const parmas = this.encodeBulkSignature(signature, {
        orderIndex: i,
        proof: proofs[i],
      });
      order.params = {
        ...order.params,
        ...parmas,
      };
    });
  }

  getBulkSignatureDataWithProofs(orders: Order[]) {
    const firstOrder = orders[0];
    const orderKind = firstOrder.params.kind!;

    if (!orders.every((c) => c.params.kind === orderKind)) {
      throw new Error("Only same kind orders can be bulk-signed");
    }

    const height = Math.max(Math.ceil(Math.log2(orders.length)), 1);

    const types = { ...firstOrder.getEip712TypesAndValue()[0] };
    const originalType = Object.keys(types)[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (types as any)[`Bulk${originalType}`] = [
      { name: "tree", type: `${originalType}${`[2]`.repeat(height)}` },
    ];

    const encoder = _TypedDataEncoder.from(types);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hashElement = (element: any) => encoder.hashStruct(originalType, element);

    const elements = orders.map((o) => o.getEip712TypesAndValue()[1]);
    const leaves = elements.map((e) => hashElement(e));

    const hexToBuffer = (value: string) => Buffer.from(value.slice(2), "hex");
    const bufferKeccak = (value: string) => hexToBuffer(keccak256(value));
    const tree = new MerkleTree(leaves.map(hexToBuffer), bufferKeccak, {
      sort: false,
      hashLeaves: false,
    });

    let chunks: object[] = [...elements];
    while (chunks.length > 2) {
      const newSize = Math.ceil(chunks.length / 2);
      chunks = Array(newSize)
        .fill(0)
        .map((_, i) => chunks.slice(i * 2, (i + 1) * 2));
    }

    return {
      signatureData: {
        signatureKind: "eip712",
        domain: EIP712_DOMAIN(this.chainId),
        types,
        value: { tree: chunks },
        primaryType: _TypedDataEncoder.getPrimaryType(types),
      },
      proofs: orders.map((_, i) => tree.getHexProof(leaves[i], i)),
    };
  }
}
