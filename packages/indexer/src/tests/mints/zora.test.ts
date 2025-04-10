import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import * as Sdk from "@reservoir0x/sdk";

Sdk.Global.Config.addresses = Sdk.Addresses;
Sdk.Global.Config.aggregatorSource = "reservoir.tools";

import {
  extractByCollectionERC1155,
  extractByCollectionERC721,
  extractByTx,
  // convertToCollectionMint,
} from "../../orderbook/mints/calldata/detector/zora";
import { jest, describe, it, expect } from "@jest/globals";
import * as utils from "@/events-sync/utils";
import { generateCollectionMintTxData } from "@/orderbook/mints/calldata";
import { config } from "@/config/index";
import { baseProvider } from "@/common/provider";
import { MintDetails } from "@reservoir0x/sdk/dist/router/v6/types";

jest.setTimeout(1000 * 1000);

describe("Mints - Zora", () => {
  it("erc1155-public-sale", async () => {
    const collection = `0xafd7b9edc5827f7e39dcd425d8de8d4e1cb292c1`;
    const infos = await extractByCollectionERC1155(collection, "0");
    expect(infos.length).not.toBe(0);
  });

  it("erc721-sale-reward", async () => {
    // goerli
    const collection = `0x6C5D3A872d3B38C1b0fF1fde12Bf2f34297AddCe`;
    const infos = await extractByCollectionERC721(collection);
    expect(infos.length).not.toBe(0);
  });

  it("erc1155-sale-reward", async () => {
    const collection = `0x60d35A892110705a09a7385efF144575F8f5D4cE`;
    const infos = await extractByCollectionERC1155(collection, "1");
    expect(infos.length).not.toBe(0);
    expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
  });

  it("erc1155-new-case", async () => {
    const collection = `0xbafd92d5e08ddcbf238e96c6c7fe60c53fbbd72f`;
    const transcation = await utils.fetchTransaction(
      "0x0675019757d038516fc479db53d1311719afe0b2df5bccd52eec99c8cbed03eb"
    );
    const infos = await extractByTx(collection, transcation);
    // console.log("infos", infos)
    expect(infos.length).not.toBe(0);
    expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
  });

  it("multicall", async () => {
    const collection = `0x48f4724fabf58f710c1f97632a93399e441d8ceb`;
    const transcation = await utils.fetchTransaction(
      "0xad0b13a1acac2d99ffaa9d79ea3f8df21e72dc86c03926a1c7a381ec444a72b0"
    );
    const infos = await extractByTx(collection, transcation);
    // console.log("infos", infos)
    expect(infos.length).not.toBe(0);
    expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
  });

  it("erc20-minter", async () => {
    const collection = `0x953a677ace4d7cd92d39f489ed7ae29f0e7c12e1`;
    const minter = "0xd5c0d17ccb9071d27a4f7ed8255f59989b9aee0d";
    const transcation = await utils.fetchTransaction(
      "0xe2c59c6def4939d62b0336dc80ee6bfe8c3c5392b4f0110cb7e5bf1e270f84db"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log("infos", collectionMints);
    const router = new Sdk.RouterV6.Router(config.chainId, baseProvider);
    expect(collectionMints.length).not.toBe(0);
    const mintDetails: MintDetails[] = [];
    for (const collectionMint of collectionMints) {
      const { txData } = await generateCollectionMintTxData(collectionMint, minter, 1);
      mintDetails.push({
        orderId: String(Math.random()),
        txData,
        fees: [],
        token: collectionMint.contract,
        quantity: 1,
        comment: "",
        currency: collectionMint.currency,
        price: collectionMint.price,
      });
      expect(txData.value).toBe(undefined);
    }
    const mintsResult = await router.fillMintsTx(mintDetails, minter);
    for (const { approvals } of mintsResult.txs) {
      // ERC20 mint requires approvals
      expect(approvals.length).not.toBe(0);
    }
    expect(collectionMints[0]?.details.tx.data.signature).toBe("0xf54f216a");
  });

  it("mint-detect-issue", async () => {
    // Optimism
    const collection = `0x0a7695F65733cC8a3531babfD9e1E60cbE23f178`;
    const transcation = await utils.fetchTransaction(
      "0x166f4fa322577a52b5a984a2224873d56ec87349b80d699dddab6723b5b963e8"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // expect(collectionMints.length).not.toBe(0);
    // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0x0000000000000000000000000000000000000001",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0x9dbb844d")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });

  // it("premints", async () => {
  //   // Zora
  //   const collectionMints = await convertToCollectionMint([
  //     {
  //       collection: {
  //         contractAdmin: "0xd272a3cb66bea1fa7547dad5b420d5ebe14222e5",
  //         contractURI: "ipfs://bafkreicuxlqqgoo6fxlmijqvilckvwj6ey26yvzpwg73ybcltvvek2og6i",
  //         contractName: "Fancy title",
  //       },
  //       premint: {
  //         tokenConfig: {
  //           tokenURI: "ipfs://bafkreia474gkk2ak5eeqstp43nqeiunqkkfeblctna3y54av7bt6uwehmq",
  //           maxSupply: "0xffffffffffffffff",
  //           maxTokensPerAddress: 0,
  //           pricePerToken: 0,
  //           mintStart: 1708100240,
  //           mintDuration: 2592000,
  //           royaltyBPS: 500,
  //           payoutRecipient: "0xd272a3cb66bea1fa7547dad5b420d5ebe14222e5",
  //           fixedPriceMinter: "0x04e2516a2c207e84a1839755675dfd8ef6302f0a",
  //           createReferral: "0x0000000000000000000000000000000000000000",
  //         },
  //         uid: 1,
  //         version: 1,
  //         deleted: false,
  //       },
  //       collectionAddress: "0x0cfbce0e2ea475d6413e2f038b2b62e64106ad1f",
  //       chainId: 7777777,
  //       signature:
  //         "0x2eb4d27a5b04fd41bdd33f66a18a4993c0116724c5fe5b8dc20bf22f45455c621139eabdbd27434e240938a60b1952979c9dc9c8a141cc71764786fe4d3f909f1c",
  //     },
  //   ]);
  //   // expect(collectionMints.length).not.toBe(0);
  //   // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
  //   for (const collectionMint of collectionMints) {
  //     const data = await generateCollectionMintTxData(
  //       collectionMint,
  //       "0x0000000000000000000000000000000000000001",
  //       1
  //     );
  //     // console.log("data", data);
  //     expect(data.txData.data.includes("0xd0634749")).toBe(true);
  //     //     const result = await simulateCollectionMint(collectionMint);
  //     //     expect(result).toBe(true);
  //   }
  // });

  it("zora-issue-07", async () => {
    // Zora
    const collection = `0x733C2567e2AD0c98771fd391C7Cd323fd55c7645`;
    const transcation = await utils.fetchTransaction(
      "0x21d2b3bcf9cfaa8fa94855342f39651e07daf53b90cc3f32cb3361fd24228a32"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log('collectionMints', collectionMints)
    expect(collectionMints.length).not.toBe(0);
    // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
    // for (const collectionMint of collectionMints) {
    //   const data = await generateCollectionMintTxData(
    //     collectionMint,
    //     "0x0000000000000000000000000000000000000001",
    //     1
    //   );
    //   console.log("data", data);
    //   expect(data.txData.data.includes("0x9dbb844d")).toBe(true);
    //       const result = await simulateCollectionMint(collectionMint);
    //       expect(result).toBe(true);
    // }
  });

  it("zora-issue-09", async () => {
    // Zora
    const collection = `0x772Bd6E9dd32884716FB41544BF03CD322afbd93`;
    const transcation = await utils.fetchTransaction(
      "0xe009f93a4d1c754aa2eaeb13fefe6e81889c84007b19caf92685e12924f4f746"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log('collectionMints', collectionMints)
    expect(collectionMints.length).not.toBe(0);
    // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
    // for (const collectionMint of collectionMints) {
    //   const data = await generateCollectionMintTxData(
    //     collectionMint,
    //     "0x0000000000000000000000000000000000000001",
    //     1
    //   );
    //   console.log("data", data);
    //   expect(data.txData.data.includes("0x9dbb844d")).toBe(true);
    //       const result = await simulateCollectionMint(collectionMint);
    //       expect(result).toBe(true);
    // }
  });

  // premint
  it("zora-issue-premint", async () => {
    // Zora
    const collection = `0x0659e5fc1c38daf3629f92891319a74cd891091d`;
    const transcation = await utils.fetchTransaction(
      "0xb36f0307025f0976a97c83d49c466d5e0500cef8c491d8b9210dfa19ab95ca95"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log("collectionMints", collectionMints);
    expect(collectionMints.length).not.toBe(0);
    // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0xC971c4E2C7C2eaC9a8358f6b9c3B923A93009F8F",
        1
      );
      expect(data.txData.data.includes("0a8945df")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });

  it("zora-issue-newver", async () => {
    // Zora
    const collection = `0x772Bd6E9dd32884716FB41544BF03CD322afbd93`;
    const transcation = await utils.fetchTransaction(
      "0x7a4237400224d450db64666a82aecb8f8428bf1118955ecedc1aa431630bf7f2"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log("collectionMints", collectionMints);
    expect(collectionMints.length).not.toBe(0);
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0xC971c4E2C7C2eaC9a8358f6b9c3B923A93009F8F",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0x359f1302")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });

  it("zora-timed", async () => {
    // Zora
    const collection = `0xF77590da8F8b4a0974a713F88C6E8AB0A7B9A8f9`;
    const transcation = await utils.fetchTransaction(
      "0xa0a0977aab7969d37dae70183122a6006fe98b5e1c4e6f95bed6912273ce007a"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log("collectionMints", collectionMints);
    expect(collectionMints.length).not.toBe(0);
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0xC971c4E2C7C2eaC9a8358f6b9c3B923A93009F8F",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0xa836f32f")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });

  it("zora-updates", async () => {
    // Zora
    const collection = `0xfe9117d6d0b973faae61d9a85a741ce41bd4bc80`;
    const transcation = await utils.fetchTransaction(
      "0x7dd400a02380b23fcc5502edb47d7b2c06f14e6049fc3977c5cc314a40be285b"
    );
    const collectionMints = await extractByTx(collection, transcation);
    // console.log("collectionMints", collectionMints);
    expect(collectionMints.length).not.toBe(0);
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0xC971c4E2C7C2eaC9a8358f6b9c3B923A93009F8F",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0xa836f32f")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });
});
