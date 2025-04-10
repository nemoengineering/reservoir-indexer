import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as Sdk from "@reservoir0x/sdk/src";
import { expect } from "chai";
import { ethers } from "hardhat";
import { bn, getChainId, reset, setupRouterWithModules } from "../../utils";

describe("[ReservoirV6_0_1] Filling Zora V4 listings and bids via the SDK", () => {
  const chainId = getChainId();

  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  beforeEach(async () => {
    [deployer, alice, bob, carol] = await ethers.getSigners();

    try {
      await setupRouterWithModules(chainId, deployer);
    } catch {
      // Skip errors
    }
  });

  const getBalances = async (token: string) => {
    if (token === Sdk.Common.Addresses.Native[chainId]) {
      return {
        alice: await ethers.provider.getBalance(alice.address),
        bob: await ethers.provider.getBalance(bob.address),
        carol: await ethers.provider.getBalance(carol.address),
        zoraV4Module: await ethers.provider.getBalance(
          Sdk.RouterV6.Addresses.ZoraV4Module[chainId]
        ),
        router: await ethers.provider.getBalance(Sdk.RouterV6.Addresses.Router[chainId]),
      };
    } else {
      const contract = new Sdk.Common.Helpers.Erc20(ethers.provider, token);
      return {
        alice: await contract.getBalance(alice.address),
        bob: await contract.getBalance(bob.address),
        carol: await contract.getBalance(carol.address),
        zoraV4Module: await contract.getBalance(Sdk.RouterV6.Addresses.ZoraV4Module[chainId]),
        router: await contract.getBalance(Sdk.RouterV6.Addresses.Router[chainId]),
      };
    }
  };

  afterEach(reset);

  const testPool = "0xe241ef55d45dec2f3ef739b6824c5e841e1ebb04";
  const collection = "0x189d1b324600b134D2929e331d1ee275297505c9";
  const tokenId = "42";

  const testFillListing = async () => {
    const nft = new Sdk.Common.Helpers.Erc1155(ethers.provider, collection);
    const buyOrder = new Sdk.ZoraV4.Order(chainId, {
      pool: testPool,
      side: "buy",
      collection,
      tokenId,
      price: "0",
      extra: {
        prices: [],
      },
    });

    const { price } = await buyOrder.getQuote(10, ethers.provider);
    buyOrder.params.price = price;

    const router = new Sdk.RouterV6.Router(chainId, ethers.provider);

    const nftBalanceBefore = await nft.getBalance(carol.address, tokenId);
    const balanceBefore = await ethers.provider.getBalance(carol.address);

    const tx = await router.fillListingsTx(
      [
        {
          // Irrelevant
          orderId: "0",
          kind: "zora-v4",
          contractKind: "erc1155",
          currency: Sdk.Common.Addresses.Native[chainId],
          contract: collection,
          tokenId: tokenId,
          order: buyOrder,
          price: price,
        },
      ],
      carol.address
    );

    for (const step of tx.txs) {
      delete step.txData.gas;
      await carol.sendTransaction(step.txData);
    }

    const ethBalancesAfter = await getBalances(Sdk.Common.Addresses.Native[chainId]);
    const nftBalanceAfter = await nft.getBalance(carol.address, tokenId);
    const balanceAfter = await ethers.provider.getBalance(carol.address);

    const receivedNftAmount = nftBalanceAfter.sub(nftBalanceBefore);
    const receivedAmount = balanceBefore.sub(balanceAfter);

    expect(receivedNftAmount).to.eq(1);
    expect(receivedAmount).to.gte(price);
    expect(ethBalancesAfter.router).to.eq(0);
    expect(ethBalancesAfter.zoraV4Module).to.eq(0);
  };

  it("Fill single listing with router", async () => testFillListing());

  it("Fill single bid with router", async () => {
    await testFillListing();

    const nft = new Sdk.Common.Helpers.Erc1155(ethers.provider, collection);
    const sellOrder = new Sdk.ZoraV4.Order(chainId, {
      pool: testPool,
      side: "sell",
      collection,
      tokenId,
      price: "0",
      extra: {
        prices: [],
      },
    });

    const { price } = await sellOrder.getQuote(20, ethers.provider);
    sellOrder.params.price = price;

    const nftBalanceBefore = await nft.getBalance(carol.address, tokenId);
    const balanceBefore = await ethers.provider.getBalance(carol.address);
    {
      const router = new Sdk.RouterV6.Router(chainId, ethers.provider);

      const tx = await router.fillBidsTx(
        [
          {
            // Irrelevant
            orderId: "0",
            kind: "zora-v4",
            contractKind: "erc1155",
            currency: Sdk.Common.Addresses.Native[chainId],
            contract: collection,
            tokenId: tokenId,
            order: sellOrder,
            price: price,
          },
        ],
        carol.address,
        {
          partial: false,
        }
      );

      for (const step of tx.txs) {
        delete step.txData.gas;
        await carol.sendTransaction(step.txData);
      }
    }

    const ethBalancesAfter = await getBalances(Sdk.Common.Addresses.Native[chainId]);
    const nftBalanceAfter = await nft.getBalance(carol.address, tokenId);
    const balanceAfter = await ethers.provider.getBalance(carol.address);
    const nftAmountSold = nftBalanceBefore.sub(nftBalanceAfter);
    const soldEthAmount = balanceAfter.sub(balanceBefore);

    const diffAmount = soldEthAmount.sub(bn(price));
    const diffPercent = bn(diffAmount).mul(100).div(price);

    expect(nftAmountSold).to.eq(1);
    expect(diffPercent).to.lt(1);

    expect(ethBalancesAfter.router).to.eq(0);
    expect(ethBalancesAfter.zoraV4Module).to.eq(0);
  });
});
