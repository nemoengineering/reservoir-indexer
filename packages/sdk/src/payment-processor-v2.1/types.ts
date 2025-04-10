import { BigNumberish } from "@ethersproject/bignumber";

export type OrderKind =
  | "sale-approval"
  | "item-offer-approval"
  | "collection-offer-approval"
  | "token-set-offer-approval";

export enum OrderProtocols {
  ERC721_FILL_OR_KILL,
  ERC1155_FILL_OR_KILL,
  ERC1155_FILL_PARTIAL,
}

export type SignatureECDSA = {
  v: number;
  r: string;
  s: string;
};

export type Cosignature = {
  signer: string;
  taker: string;
  expiration: number;
  v: number;
  r: string;
  s: string;
};

export type BulkOrderProof = {
  orderIndex: number;
  proof: string[];
};

export type MatchedOrder = {
  protocol: OrderProtocols;
  maker: string;
  beneficiary: string;
  marketplace: string;
  paymentMethod: string;
  tokenAddress: string;
  tokenId: string;
  amount: string;
  itemPrice: string;
  nonce: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  maxRoyaltyFeeNumerator: string;
  requestedFillAmount: string;
  fallbackRoyaltyRecipient: string;
  minimumFillAmount: string;
  signature: SignatureECDSA;
};

export type SweepOrder = {
  protocol: OrderProtocols;
  tokenAddress: string;
  paymentMethod: string;
  beneficiary: string;
};

export type SweepItem = {
  maker: string;
  marketplace: string;
  fallbackRoyaltyRecipient: string;
  tokenId: string;
  amount: string;
  itemPrice: string;
  nonce: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  maxRoyaltyFeeNumerator: string;
};

export type SweepOrderParams = {
  sweepOrder: SweepOrder;
  items: SweepItem[];
  signedSellOrders: SignatureECDSA[];
  cosignatures: Cosignature[];
};

export type PermitContext = {
  permitProcessor: string;
  permitNonce: string;
};

// Type for generic order format

export type BaseOrder = {
  kind?: OrderKind;
  protocol: OrderProtocols;
  cosigner?: string;
  sellerOrBuyer: string;
  marketplace: string;
  paymentMethod: string;
  tokenAddress: string;
  amount: string;
  itemPrice: string;
  expiration: string;
  fallbackRoyaltyRecipient?: string;
  marketplaceFeeNumerator: string;
  nonce: string;
  masterNonce: string;

  // "sale-approval" only
  maxRoyaltyFeeNumerator?: string;

  // "*-offer-approval" only
  beneficiary?: string;

  // "sale-approval" and "item-offer-approval" only
  tokenId?: string;

  // "token-set-offer-approval" only
  tokenSetMerkleRoot?: string;
  tokenSetProof?: string[];
  // Internally we store the token-sets based on the Seaport logic
  seaportStyleMerkleRoot?: string;

  cosignature?: Cosignature;
  bulkOrderProof?: BulkOrderProof;

  v?: number;
  r?: string;
  s?: string;
};

// Types per individual order format

export type SaleApproval = {
  protocol: OrderProtocols;
  cosigner: string;
  seller: string;
  marketplace: string;
  fallbackRoyaltyRecipient: string;
  paymentMethod: string;
  tokenAddress: string;
  tokenId: string;
  amount: string;
  itemPrice: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  maxRoyaltyFeeNumerator: string;
  nonce: string;
  masterNonce: string;
};

export type ItemOfferApproval = {
  protocol: OrderProtocols;
  cosigner: string;
  buyer: string;
  beneficiary: string;
  marketplace: string;
  fallbackRoyaltyRecipient: string;
  paymentMethod: string;
  tokenAddress: string;
  tokenId: string;
  amount: string;
  itemPrice: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  nonce: string;
  masterNonce: string;
};

export type CollectionOfferApproval = {
  protocol: OrderProtocols;
  cosigner: string;
  buyer: string;
  beneficiary: string;
  marketplace: string;
  fallbackRoyaltyRecipient: string;
  paymentMethod: string;
  tokenAddress: string;
  amount: string;
  itemPrice: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  nonce: string;
  masterNonce: string;
};

export type TokenSetOfferApproval = {
  protocol: OrderProtocols;
  cosigner: string;
  buyer: string;
  beneficiary: string;
  marketplace: string;
  fallbackRoyaltyRecipient: string;
  paymentMethod: string;
  tokenAddress: string;
  amount: string;
  itemPrice: string;
  expiration: string;
  marketplaceFeeNumerator: string;
  nonce: string;
  masterNonce: string;
  tokenSetMerkleRoot: string;
};

export type TokenSetProof = {
  rootHash: string;
  proof: string[];
};

export type MatchingOptions = {
  taker: string;
  amount?: BigNumberish;
  tokenId?: BigNumberish;
  maxRoyaltyFeeNumerator?: BigNumberish;
  tokenIds?: BigNumberish[];
};

export const AdvancedOrder = `
  (
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
      uint256 permitNonce
    ) permitContext
  )
`;

export const AdvancedBidOrder = `
  (
    bool isCollectionLevelOffer,
    ${AdvancedOrder} advancedOrder,
    ( 
      uint256 v, 
      bytes32 r,
      bytes32 s
    ) sellerPermitSignature
  )
`;

export const FeeOnTop = "(address recipient, uint256 amount) feeOnTop";
