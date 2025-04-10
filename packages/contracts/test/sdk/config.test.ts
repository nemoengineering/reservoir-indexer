import { Contract } from "@ethersproject/contracts";
import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import * as Sdk from "@reservoir0x/sdk";
import * as Common from "@reservoir0x/sdk/src/common";
import { getSourceHash, Network } from "@reservoir0x/sdk/src/utils";
import { expect } from "chai";
import { constants } from "ethers";
import { ethers } from "hardhat";
import snapshotAddresses from "@reservoir0x/sdk/src/addresses.json";

import { getChainId, getCurrentTimestamp, reset, setupNFTs } from "../utils";

describe("Global Config", () => {
  const chainId = getChainId();

  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let erc721: Contract;

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();

    ({ erc721 } = await setupNFTs(deployer));
  });

  afterEach(reset);

  it("Config global aggregator source", async () => {
    const buyer = alice;
    const seller = bob;
    const price = parseEther("1");
    const soldTokenId = 1;

    // Mint erc721 to seller
    await erc721.connect(seller).mint(soldTokenId);
    const nft = new Common.Helpers.Erc721(ethers.provider, erc721.address);

    // Approve the exchange
    await nft.approve(seller, Sdk.PaymentProcessor.Addresses.Exchange[chainId]);

    const exchange = new Sdk.PaymentProcessor.Exchange(chainId);

    const sellerMasterNonce = await exchange.getMasterNonce(ethers.provider, seller.address);
    const takerMasterNonce = await exchange.getMasterNonce(ethers.provider, buyer.address);
    const blockTime = await getCurrentTimestamp(ethers.provider);

    const builder = new Sdk.PaymentProcessor.Builders.SingleToken(chainId);
    const orderParameters = {
      protocol: 0,
      sellerAcceptedOffer: false,
      marketplace: constants.AddressZero,
      marketplaceFeeNumerator: "0",
      maxRoyaltyFeeNumerator: "0",
      privateTaker: constants.AddressZero,
      trader: seller.address,
      tokenAddress: erc721.address,
      tokenId: soldTokenId,
      amount: "1",
      price: price,
      expiration: (blockTime + 60 * 60).toString(),
      nonce: "0",
      coin: constants.AddressZero,
      masterNonce: sellerMasterNonce,
    };

    // Build sell order
    const sellOrder = builder.build(orderParameters);
    await sellOrder.sign(seller);

    const buyOrder = sellOrder.buildMatching({
      taker: buyer.address,
      takerMasterNonce: takerMasterNonce,
    });
    await buyOrder.sign(buyer);

    buyOrder.checkSignature();
    sellOrder.checkSignature();
    await sellOrder.checkFillability(ethers.provider);

    // Set source
    const testSource = "test.xyz";
    Sdk.Global.Config.aggregatorSource = testSource;
    const currentSource = Sdk.Global.Config.aggregatorSource;

    const tx = exchange.fillOrderTx(await buyer.getAddress(), sellOrder, buyOrder);
    const source = getSourceHash(currentSource);
    expect(tx.data.endsWith(source)).to.eq(true);
    expect(testSource).to.eq(currentSource);

    // Clear source
    Sdk.Global.Config.aggregatorSource = undefined;

    const tx2 = exchange.fillOrderTx(await buyer.getAddress(), sellOrder, buyOrder);
    const source2 = getSourceHash("");
    expect(tx2.data.endsWith(source2)).to.eq(true);
  });

  it("Addresses - dynamic modify", async () => {
    Sdk.Global.Config.addresses = {
      "Alienswap": {
        "Exchange": {
          1: constants.AddressZero,
        }
      }
    }

    const exchange = new Sdk.Alienswap.Exchange(chainId);
    expect(exchange.contract.address).to.eq(constants.AddressZero);

    Sdk.Global.Config.addresses = {
      "Alienswap": {
        "Exchange": {
          1: "0x0000000000000000000000000000000000000001",
        }
      }
    }

    const exchange2 = new Sdk.Alienswap.Exchange(chainId);
    expect(exchange2.contract.address).to.eq('0x0000000000000000000000000000000000000001');

   
  });

  it("Addresses - dump", async () => {
    const addresses: any = {}
    for(const namespace of Object.keys(Sdk)) {
      if (!(Sdk as any)[namespace].Addresses) continue;
      addresses[namespace] = (Sdk as any)[namespace].Addresses;
    }
  //   const allNameSpace = [];
  //   const processed = [
  //     'RouterV6',
  // 'Beeple',        'BendDao',
  // 'Blur',          'CryptoArte',
  // 'CryptoKitties', 'CryptoPunks',
  // 'CryptoVoxels',  'Decentraland',
  // 'Ditto',         'Element',
  // 'Foundation',    'LooksRare',
  // 'Manifold',      'NftTrader',
  // 'Nftx',          'NftxV3',
  // 'Nouns',         'Okex',
  // 'Quixotic',      'Rarible',
  // 'SeaportV11',    'SeaportV14',
  // 'SeaportV15',    'SeaportV16',
  //     'Alienswap',
  // 'SeaportBase',   'Sudoswap',         'SuperRare',
  // 'TofuNft',       'Treasure',         'WyvernV2',
  // 'WyvernV23',     'X2Y2',             'ZeroExV2',
  // 'ZeroExV3',      'ZeroExV4',         'Zora',
  // 'LooksRareV2',   'Blend',            'SudoswapV2',
  // 'CaviarV1',      'PaymentProcessor', 'PaymentProcessorV2',
  // 'Seadrop',       'BlurV2',           'Joepeg',
  // 'ArtBlocks',     'Mooar',            'HighlightXyz',
  // 'FairXyz',       'ZeroExSplits',     'Mintify'
  //   ]
//     for(const namespace of Object.keys(Sdk)) {
//       // console.log(namespace, (Sdk as any)[namespace].Addresses)
//       addresses[namespace] = (Sdk as any)[namespace].Addresses;

//       if (!(Sdk as any)[namespace].Addresses) continue;
//       if (processed.includes(namespace)) continue;

//       allNameSpace.push(namespace);
//       for(const key of Object.keys((Sdk as any)[namespace].Addresses)) {

//         // console.log('', namespace, key, (Sdk as any)[namespace].Addresses[key])

//         const codes = [];

//         for(const chainId of Object.keys((Sdk as any)[namespace].Addresses[key])) {
//           codes.push(`  [Network.${Network[chainId as unknown as number]}]: "${(Sdk as any)[namespace].Addresses[key][chainId]}"`)
//         }


// const newCode = `
// export const ${key}: ChainIdToAddress = resolveAddress("${namespace}", "${key}", {
// ${codes.join(',\n')}
// });
// `
//         console.log(newCode);
//       }
//     }

//     console.log('allNameSpace', allNameSpace)

    // console.log('addresses', JSON.stringify(addresses))
  });

  it("Addresses - validate snapshot", async () => {
    for(const namespace of Object.keys(Sdk)) {
      if (!(Sdk as any)[namespace].Addresses) continue;
      for(const key of Object.keys((Sdk as any)[namespace].Addresses)) {
        for(const chainId of Object.keys((Sdk as any)[namespace].Addresses[key])) {
          const address = (Sdk as any)[namespace].Addresses[key][chainId];
          const original = (snapshotAddresses as any)[namespace][key][chainId];
          const match = address.toString() == original.toString();
          // if (!match) {
          //   console.log({
          //     address,
          //     original,
          //     key,
          //     namespace,
          //     chainId
          //   })
          // }
          expect(match).to.eq(true);
        }
      }
    }
  });
});
