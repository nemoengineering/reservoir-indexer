import { Interface } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as Sdk from "@reservoir0x/sdk/src";
import { expect } from "chai";
import { ethers } from "hardhat";

import { ExecutionInfo } from "../helpers/router";
import { bn, getChainId, reset } from "../../utils";

describe("[ReservoirV6_0_1] ZoraV4", () => {
  const chainId = getChainId();

  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let david: SignerWithAddress;
  let emilio: SignerWithAddress;

  let router: Contract;
  let zoraV4Module: Contract;

  beforeEach(async () => {
    [deployer, alice, bob, carol, david, emilio] = await ethers.getSigners();

    router = await ethers
      .getContractFactory("ReservoirV6_0_1", deployer)
      .then((factory) => factory.deploy());
    zoraV4Module = await ethers
      .getContractFactory("ZoraV4Module", deployer)
      .then((factory) =>
        factory.deploy(
          deployer.address,
          router.address,
          Sdk.ZoraV4.Addresses.SecondarySwap[chainId]
        )
      );
  });

  const getBalances = async (token: string) => {
    if (token === Sdk.Common.Addresses.Native[chainId]) {
      return {
        alice: await ethers.provider.getBalance(alice.address),
        bob: await ethers.provider.getBalance(bob.address),
        carol: await ethers.provider.getBalance(carol.address),
        david: await ethers.provider.getBalance(david.address),
        emilio: await ethers.provider.getBalance(emilio.address),
        router: await ethers.provider.getBalance(router.address),
        zoraV4Module: await ethers.provider.getBalance(zoraV4Module.address),
      };
    } else {
      const contract = new Sdk.Common.Helpers.Erc20(ethers.provider, token);
      return {
        alice: await contract.getBalance(alice.address),
        bob: await contract.getBalance(bob.address),
        carol: await contract.getBalance(carol.address),
        david: await contract.getBalance(david.address),
        emilio: await contract.getBalance(emilio.address),
        router: await contract.getBalance(router.address),
        zoraV4Module: await contract.getBalance(zoraV4Module.address),
      };
    }
  };

  afterEach(reset);

  const testPool = "0xe241ef55d45dec2f3ef739b6824c5e841e1ebb04";
  const collection = "0x189d1b324600b134D2929e331d1ee275297505c9";
  const tokenId = "42";

  const testFillListing = async () => {
    const nft = new Sdk.Common.Helpers.Erc1155(ethers.provider, collection);
    const sdkOrder = new Sdk.ZoraV4.Order(chainId, {
      pool: testPool,
      side: "buy",
      collection,
      tokenId,
      price: "0",
      extra: {
        prices: [],
      },
    });

    const { price } = await sdkOrder.getQuote(10, ethers.provider);
    sdkOrder.params.price = price;

    const executions: ExecutionInfo[] = [
      // 1. Fill listings
      {
        module: zoraV4Module.address,
        data: zoraV4Module.interface.encodeFunctionData("buyWithETH", [
          [
            {
              ...sdkOrder.params,
              amount: 1,
              sqrtPriceLimitX96: 0,
            },
          ],
          {
            fillTo: carol.address,
            refundTo: carol.address,
            revertIfIncomplete: false,
            amount: price,
          },
          [],
        ]),
        value: price,
      },
    ];

    const nftBalanceBefore = await nft.getBalance(carol.address, tokenId);
    const balanceBefore = await ethers.provider.getBalance(carol.address);

    await router.connect(carol).execute(executions, {
      value: executions.map(({ value }) => value).reduce((a, b) => bn(a).add(b), bn(0)),
    });

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

  it("Fill listing", async () => testFillListing());

  it("Fill bid", async () => {
    await testFillListing();

    const amountToSold = 1;
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
      await nft.approve(carol, zoraV4Module.address);

      await carol.sendTransaction({
        from: carol.address,
        to: collection,
        data: new Interface([
          `function safeTransferFrom(address from, address to, uint256 tokenId, uint256 amount, bytes data)`,
        ]).encodeFunctionData("safeTransferFrom", [
          carol.address,
          zoraV4Module.address,
          tokenId,
          amountToSold,
          "0x",
        ]),
      });

      const executions: ExecutionInfo[] = [
        // 1. Fill listings
        {
          module: zoraV4Module.address,
          data: zoraV4Module.interface.encodeFunctionData("sell", [
            [
              {
                ...sellOrder.params,
                amount: amountToSold,
                sqrtPriceLimitX96: 0,
              },
            ],
            {
              fillTo: carol.address,
              refundTo: carol.address,
              revertIfIncomplete: true,
            },
            [],
          ]),
          value: 0,
        },
      ];

      await router.connect(carol).execute(executions, {
        value: executions.map(({ value }) => value).reduce((a, b) => bn(a).add(b), bn(0)),
      });
    }

    const ethBalancesAfter = await getBalances(Sdk.Common.Addresses.Native[chainId]);
    const nftBalanceAfter = await nft.getBalance(carol.address, tokenId);
    const balanceAfter = await ethers.provider.getBalance(carol.address);
    const nftAmountSold = nftBalanceBefore.sub(nftBalanceAfter);
    const soldEthAmount = balanceAfter.sub(balanceBefore);

    const diffAmount = soldEthAmount.sub(price);
    const diffPercent = bn(diffAmount).mul(100).div(price);

    expect(nftAmountSold).to.eq(1);
    expect(diffPercent).to.lt(1);

    expect(ethBalancesAfter.router).to.eq(0);
    expect(ethBalancesAfter.zoraV4Module).to.eq(0);
  });
});
