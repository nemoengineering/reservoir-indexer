import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { jest, describe, it, expect } from "@jest/globals";
import * as utils from "@/events-sync/utils";
import { extractByTx } from "../../orderbook/mints/calldata/detector/partydao";
import { generateCollectionMintTxData } from "@/orderbook/mints/calldata";

jest.setTimeout(1000 * 1000);

describe("Mints - PartyDao", () => {
  it("basic", async () => {
    // Base
    const transcation = await utils.fetchTransaction(
      "0x4ea4b5d83685c051d3246bf18c3d1b40587cd347e5dcd662a94f117fcae2a455"
    );
    const collectionMints = await extractByTx(
      "0xfc2e15e17867cb64ae1d5bcfc9ffbe97c8bb61cc",
      transcation
    );
    // console.log('collectionMints', collectionMints)
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0x3a78b26d40756344fd16ac31be9597bf4f6c68d5",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0xe7a79057")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }

    // expect(collectionMints[0].stage.includes("public-")).not.toBe(false);
    // for (const collectionMint of collectionMints) {
    //   const result = await simulateCollectionMint(collectionMint);
    //   expect(result).toBe(true);
    // }
  });

  it("SellPartyCardsAuthority", async () => {
    // Base
    const transcation = await utils.fetchTransaction(
      "0xa15ae0220f6719fc87f7fbafc4a12354829a88c89b353090404e62e5513808f8"
    );
    const collectionMints = await extractByTx(
      "0xd5bdf67553c7f635749951ce1c9260d736476f12",
      transcation
    );
    // console.log("collectionMints", collectionMints);
    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0x3a78b26d40756344fd16ac31be9597bf4f6c68d5",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0xe7a79057")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }

    // expect(collectionMints[0].stage.includes("public-")).not.toBe(false);
    // for (const collectionMint of collectionMints) {
    //   const result = await simulateCollectionMint(collectionMint);
    //   expect(result).toBe(true);
    // }
  });
});
