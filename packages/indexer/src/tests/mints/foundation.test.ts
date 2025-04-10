import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import * as Sdk from "@reservoir0x/sdk";

Sdk.Global.Config.addresses = Sdk.Addresses;
Sdk.Global.Config.aggregatorSource = "reservoir.tools";

import { describe, expect, it, jest } from "@jest/globals";
import { Network } from "@reservoir0x/sdk/dist/utils";

import { config } from "../../config";
import * as Foundation from "../../orderbook/mints/calldata/detector/foundation";
import * as utils from "@/events-sync/utils";
import { generateCollectionMintTxData } from "@/orderbook/mints/calldata";

jest.setTimeout(60 * 1000);

if (config.chainId === Network.Ethereum) {
  describe("Mints - Foundation", () => {
    it("public-sale", async () => {
      const collection = "0x5959cddbe6b96afb19014fd77735a784f3e99a5f";
      const info = await Foundation.extractByCollectionERC721(collection);
      expect(info.length).not.toBe(0);
    });

    it("allowlist-sale", async () => {
      const collection = "0x738541f5ed9bc7ac8943df55709d5002693b43e3";
      const info = await Foundation.extractByCollectionERC721(collection);
      expect(info.length).not.toBe(0);
    });
  });
}

if (config.chainId === Network.Base) {
  describe("Mints - Foundation", () => {
    it("mint-detect-issue", async () => {
      const collection = `0x0f3Dd947a38410E7f886d41dE8B4d3313Bb8487b`;
      const transcation = await utils.fetchTransaction(
        "0x0117dfe7dbae480336e20c607cf622668deed08985b0b1dccda6afaed0c14978"
      );
      const collectionMints = await Foundation.extractByTx(collection, transcation);
      // expect(collectionMints.length).not.toBe(0);
      // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
      // console.log("collectionMints", collectionMints);
      for (const collectionMint of collectionMints) {
        const data = await generateCollectionMintTxData(
          collectionMint,
          "0x0000000000000000000000000000000000000001",
          1
        );
        // console.log("data", data);
        expect(data.txData.data.includes("0x334965c2")).toBe(true);
        //     const result = await simulateCollectionMint(collectionMint);
        //     expect(result).toBe(true);
      }
    });

    it("erc1155-multi", async () => {
      const collection = `0x1d2550d198197df1a10af515cf2ea0d790889b93`;
      const transcation = await utils.fetchTransaction(
        "0x02da214908588a224ab30b2fede6643a655e68dbc757d2b5991154d6f1a75727"
      );
      const collectionMints = await Foundation.extractByTx(collection, transcation);
      // expect(collectionMints.length).not.toBe(0);
      // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
      // console.log("collectionMints", collectionMints);
      for (const collectionMint of collectionMints) {
        const data = await generateCollectionMintTxData(
          collectionMint,
          "0x0000000000000000000000000000000000000001",
          1
        );
        // console.log("data", data);
        expect(data.txData.data.includes("0x337fae59")).toBe(true);
        //     const result = await simulateCollectionMint(collectionMint);
        //     expect(result).toBe(true);
      }
    });

    it("erc1155", async () => {
      const collection = `0x28959e81c0277c744105a9c1dd8ce0d3e8d45cbb`;
      const transcation = await utils.fetchTransaction(
        "0x295e82450ad99f58dadf090f1f01e73f2c0bf4f1c70d469ca1bdd6e9e067e1fb"
      );
      const collectionMints = await Foundation.extractByTx(collection, transcation);
      // expect(collectionMints.length).not.toBe(0);
      // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
      // console.log("collectionMints", collectionMints);
      for (const collectionMint of collectionMints) {
        const data = await generateCollectionMintTxData(
          collectionMint,
          "0x0000000000000000000000000000000000000001",
          1
        );
        // console.log("data", data);
        expect(data.txData.data.includes("0x337fae59")).toBe(true);
        //     const result = await simulateCollectionMint(collectionMint);
        //     expect(result).toBe(true);
      }
    });

    it("erc1155-multi-config", async () => {
      const collection = `0x0c9d3f78F3D2F322a67396A185d893528314bc53`;
      const collectionMints = await Foundation.extractByCollectionERC1155(collection, "2");
      // expect(collectionMints.length).not.toBe(0);
      // expect(infos[0]?.details.tx.data.signature).toBe("0x9dbb844d");
      // console.log("collectionMints", collectionMints);
      for (const collectionMint of collectionMints) {
        const data = await generateCollectionMintTxData(
          collectionMint,
          "0x0000000000000000000000000000000000000001",
          1
        );
        // console.log("data", data);
        expect(data.txData.data.includes("0x337fae59")).toBe(true);
        //     const result = await simulateCollectionMint(collectionMint);
        //     expect(result).toBe(true);
      }
    });
  });
}
