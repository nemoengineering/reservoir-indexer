import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { jest, describe, it, expect } from "@jest/globals";
import * as utils from "@/events-sync/utils";
import { extractByTx } from "../../orderbook/mints/calldata/detector/basepaint";
// import { simulateCollectionMint } from "@/orderbook/mints/simulation";
import { generateCollectionMintTxData } from "@/orderbook/mints/calldata";

jest.setTimeout(1000 * 1000);

describe("Mints - BasePaint", () => {
  it("basic", async () => {
    // Base
    const transcation = await utils.fetchTransaction(
      "0x5fed7654af65cda7c559823c79078d99ca6db74152ec680fbd1d32f6388d0254"
    );
    const collectionMints = await extractByTx(
      "0xba5e05cb26b78eda3a2f8e3b3814726305dcac83",
      transcation
    );

    for (const collectionMint of collectionMints) {
      const data = await generateCollectionMintTxData(
        collectionMint,
        "0x0000000000000000000000000000000000000001",
        1
      );
      // console.log("data", data);
      expect(data.txData.data.includes("0xe9eb7008")).toBe(true);
      //     const result = await simulateCollectionMint(collectionMint);
      //     expect(result).toBe(true);
    }
  });
});
