import { Interface } from "@ethersproject/abi";

import { EventData } from "@/events-sync/data";

export const salesConfigChanged: EventData = {
  kind: "zora",
  subKind: "zora-sales-config-changed",
  topic: "0xc1ff5e4744ac8dd2b8027a10e3723b165975297501c71c4e7dcb8796d96375db",
  numTopics: 2,
  abi: new Interface([`event SalesConfigChanged(address indexed changedBy)`]),
};

export const updatedToken: EventData = {
  kind: "zora",
  subKind: "zora-updated-token",
  topic: "0x5086d1bcea28999da9875111e3592688fbfa821db63214c695ca35768080c2fe",
  numTopics: 3,
  abi: new Interface([
    `event UpdatedToken(
      address indexed from,
      uint256 indexed tokenId,
      (
        string uri,
        uint256 maxSupply,
        uint256 totalMinted
      ) tokenData
    )`,
  ]),
};

export const mintComment: EventData = {
  kind: "zora",
  subKind: "zora-mint-comment",
  topic: "0xb9490aee663998179ad13f9e1c1eb6189c71ad1a9ec87f33ad2766f98d9a268a",
  numTopics: 4,
  abi: new Interface([
    `event MintComment(
      address indexed sender,
      address indexed tokenContract,
      uint256 indexed tokenId,
      uint256 quantity,
      string comment
    )`,
  ]),
};

// This should not have the kind set as `zora`
export const customMintComment: EventData = {
  kind: "zora",
  subKind: "zora-custom-mint-comment",
  topic: "0x2910744449a1123a8844cbafb0eb9444d337afddbf9fa11116964067fd248128",
  numTopics: 1,
  abi: new Interface([
    "event MintComment(address indexed tokenContract, uint256 quantity, string comment)",
  ]),
};

export const fixedPriceSaleSet: EventData = {
  kind: "zora",
  subKind: "zora-fixed-price-sale-set",
  topic: "0x5e4ad74f00b9a9d4a8452359a7fbd80cc5a6930a9df5e5b797ddc024b24b252c",
  numTopics: 3,
  abi: new Interface([
    `event SaleSet(
      address indexed collection,
      uint256 indexed tokenId,
      (
        uint64 saleStart,
        uint64 saleEnd,
        uint64 maxTokensPerAddress,
        uint96 pricePerToken,
        address fundsRecipient
      ) salesConfig
    )`,
  ]),
};

export const merkleSaleSet: EventData = {
  kind: "zora",
  subKind: "zora-merkle-sale-set",
  topic: "0x82ae5a22c3160d46d62997cfa6f39886b3126a3701c0e42ff3ce4f0b1b6ad0e3",
  numTopics: 3,
  abi: new Interface([
    `event SaleSet(
      address indexed collection,
      uint256 indexed tokenId,
      (
        uint64 presaleStart,
        uint64 presaleEnd,
        address fundsRecipient,
        bytes32 merkleRoot
      ) salesConfig
    )`,
  ]),
};

export const timedSaleSet: EventData = {
  kind: "zora",
  subKind: "zora-timed-sale-set",
  topic: "0x0eb75baee9035d7d1cf49fafe6f85bda3c71c4ec61a1d3c6a27877e58b55c73b",
  numTopics: 3,
  abi: new Interface([
    `event SaleSet(
      address indexed collection,
      uint256 indexed tokenId,
      (
        uint64 saleStart,
        uint64 saleEnd,
        string name,
        string symbol
      ) salesConfig,
      address erc20zAddress,
      address poolAddress,
      uint256 mintFee
    )`,
  ]),
};

export const erc20SaleSet: EventData = {
  kind: "zora",
  subKind: "zora-erc20-sale-set",
  topic: "0x5a10ca3dd9f8e42a050c7f379d07bacd686570baf0b1c8574362fc474a9aa1a0",
  numTopics: 3,
  abi: new Interface([
    `event SaleSet(
      address indexed collection,
      uint256 indexed tokenId,
      (
        uint64 saleStart,
        uint64 saleEnd,
        uint64 maxTokensPerAddress,
        uint256 pricePerToken,
        address fundsRecipient,
        address currency
      ) salesConfig
    )`,
  ]),
};

export const timedSaleStrategyRewards: EventData = {
  kind: "zora",
  subKind: "zora-timed-sale-strategy-rewards",
  topic: "0xc773e203af3f3079b18c21f98bb8d8ccd2fea097d631d448df89de4edbe7a2a8",
  numTopics: 3,
  abi: new Interface([
    `event ZoraTimedSaleStrategyRewards(
      address indexed collection, 
      uint256 indexed tokenId, 
      address creator, 
      uint256 creatorReward, 
      address createReferral, 
      uint256 createReferralReward, 
      address mintReferral, 
      uint256 mintReferralReward, 
      address market, 
      uint256 marketReward, 
      address zoraRecipient, 
      uint256 zoraReward
    )`,
  ]),
};

export const timedSaleV2Set: EventData = {
  kind: "zora",
  subKind: "zora-timed-sale-set-v2",
  topic: "0x15f22ac713e035d96268fecbfcee5494861af1e49e2fe7620400419fe06843a5",
  numTopics: 3,
  abi: new Interface([
    `event SaleSetV2(
      address indexed collection,
      uint256 indexed tokenId,
      (
        uint64 saleStart,
        uint64 marketCountdown,
        uint64 saleEnd,
        bool secondaryActivated,
        uint256 minimumMarketEth,
        address poolAddress,
        address payable erc20zAddress,
        string name,
        string symbol
      ) saleData,
      uint256 mintFee
    )`,
  ]),
};

export const secondaryMarketActivated: EventData = {
  kind: "zora",
  subKind: "zora-secondary-market-activated",
  topic: "0xcdfae23ab73652b197b1d3756f9ec1ea5bf4b7af041fd45a5682e1349cda4d6c",
  numTopics: 3,
  abi: new Interface([
    `event SecondaryMarketActivated(
      address indexed token0,
      uint256 indexed amount0,
      address token1,
      uint256 amount1,
      uint256 fee,
      uint256 positionId,
      uint256 lpLiquidity,
      uint256 erc20Excess,
      uint256 erc1155Excess
    )`,
  ]),
};

export const swap: EventData = {
  kind: "zora",
  subKind: "zora-swap",
  topic: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  numTopics: 3,
  abi: new Interface([
    `event Swap(
      address indexed sender,
      uint256 amount0,
      uint256 amount1,
      unit160 sqrtPriceX96,
      uint128 liquidity,
      int24 tick,
      address indexed recipient
    )`,
  ]),
};

export const secondaryBuy: EventData = {
  kind: "zora",
  subKind: "zora-secondary-buy",
  topic: "0x72d6b4b5ad0fb12b8a7bb3bcb60edd774c096403d611437859c156ecb3c03a36",
  numTopics: 4,
  abi: new Interface([
    `event SecondaryBuy(
      address indexed msgSender,
      address indexed recipient,
      address indexed erc20zAddress,
      uint256 totalPirce,
      uint256 amount
    )`,
  ]),
};

export const secondarySell: EventData = {
  kind: "zora",
  subKind: "zora-secondary-sell",
  topic: "0xce7a9659161c4da85bb2316f11bb01521a23f37c260ae347af58e5789f138920",
  numTopics: 4,
  abi: new Interface([
    `event SecondarySell(
      address indexed msgSender,
      address indexed recipient,
      address indexed erc20zAddress,
      uint256 totalPirce,
      uint256 amount
    )`,
  ]),
};
