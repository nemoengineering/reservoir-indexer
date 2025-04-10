import { ethers } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { Contract } from "@ethersproject/contracts";
import { keccak256 as solidityKeccak256 } from "@ethersproject/solidity";

import * as Addresses from "./addresses";

import ConduitControllerAbi from "./abis/ConduitController.json";

export class ConduitController {
  public chainId: number;
  public contract: Contract;

  constructor(chainId: number, provider?: Provider) {
    this.chainId = chainId;
    this.contract = new Contract(
      Addresses.ConduitController[this.chainId],
      ConduitControllerAbi,
      provider
    );
  }

  public deriveConduit(conduitKey: string) {
    if (Addresses.ConduitControllerRuntimeCodeHash[this.chainId]) {
      return (
        "0x" +
        solidityKeccak256(
          ["bytes32", "bytes32", "bytes32", "bytes32", "bytes"],
          [
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes("zksyncCreate2")),
            ethers.utils.zeroPad(Addresses.ConduitController[this.chainId], 32),
            conduitKey,
            Addresses.ConduitControllerRuntimeCodeHash[this.chainId],
            ethers.utils.keccak256("0x"),
          ]
        ).slice(-40)
      );
    } else {
      return (
        "0x" +
        solidityKeccak256(
          ["bytes1", "address", "bytes32", "bytes32"],
          [
            "0xff",
            Addresses.ConduitController[this.chainId],
            conduitKey,
            Addresses.ConduitControllerCodeHash[this.chainId],
          ]
        ).slice(-40)
      );
    }
  }

  public async getChannelStatus(conduit: string, channelAddress: string): Promise<boolean> {
    return this.contract.getChannelStatus(conduit, channelAddress);
  }
}
