/* eslint-disable @typescript-eslint/no-explicit-any */

import { Tokens } from "@/models/tokens";
import { idb, redb } from "@/common/db";
import { bn, toBuffer } from "@/common/utils";
import { AbstractRabbitMqJobHandler } from "@/jobs/abstract-rabbit-mq-job-handler";
import _ from "lodash";
import { acquireLock } from "@/common/redis";
import { getNetworkSettings } from "@/config/network";
import { AddressZero } from "@ethersproject/constants";
import { collectionReclacSupplyJob } from "@/jobs/collection-updates/collection-reclac-supply-job";
import { config } from "@/config/index";

export type TokenRecalcSupplyPayload = {
  contract: string;
  tokenId: string;
};

export default class TokenReclacSupplyJob extends AbstractRabbitMqJobHandler {
  queueName = "token-reclac-supply";
  maxRetries = 1;
  concurrency = _.includes([56], config.chainId) ? 5 : 10;
  useSharedChannel = true;

  public async process(payload: TokenRecalcSupplyPayload) {
    const { contract, tokenId } = payload;

    if (contract === "0x4d97dcd97ec945f40cf65f87097ace5ea0476045") {
      return;
    }

    if (contract === "0x251be3a17af4892035c37ebf5890f4a4d889dcad") {
      return;
    }

    const token = await Tokens.getByContractAndTokenId(contract, tokenId);

    // For large supply tokens calc once a day
    if (
      token &&
      token.supply > 50000 &&
      !(await acquireLock(`${this.queueName}:${contract}:${tokenId}`, 60 * 60 * 24))
    ) {
      return;
    }

    const totalSupply = await this.calcTotalSupply(contract, tokenId);
    let totalRemainingSupply = await this.calcRemainingSupply(contract, tokenId);

    if (bn(totalRemainingSupply).gt(totalSupply)) {
      totalRemainingSupply = totalSupply;
    }

    const result = await idb.result(
      `
        UPDATE tokens SET
          supply = $/totalSupply/,
          remaining_supply = $/totalRemainingSupply/,
          updated_at = now()
        WHERE tokens.contract = $/contract/
          AND tokens.token_id = $/tokenId/
          AND (supply IS DISTINCT FROM $/totalSupply/ OR remaining_supply IS DISTINCT FROM $/totalRemainingSupply/)
      `,
      {
        contract: toBuffer(contract),
        tokenId,
        totalSupply,
        totalRemainingSupply,
      }
    );

    // If there's been any update schedule collection recalc
    if (result.rowCount && token?.collectionId) {
      await collectionReclacSupplyJob.addToQueue([{ collection: token.collectionId }], 0);
    }
  }

  public async calcRemainingSupply(contract: string, tokenId: string) {
    const limit = 1000;
    let remainingSupply = "0";
    let continuation = "";
    let nftBalances = [];

    const values: {
      contract: Buffer;
      tokenId: string;
      burnAddresses: Buffer[];
      limit: number;
      lastContract?: Buffer;
      lastTokenId?: string;
      lastOwner?: Buffer;
    } = {
      contract: toBuffer(contract),
      tokenId: tokenId,
      burnAddresses: getNetworkSettings().burnAddresses.map((address) => toBuffer(address)),
      limit,
    };

    do {
      const totalRemainingSupplyQuery = `
        SELECT contract, token_id, owner, amount
        FROM nft_balances
        WHERE contract = $/contract/
        AND token_id = $/tokenId/
        AND owner NOT IN ($/burnAddresses:list/)
        AND amount > 0
        ${continuation}
        ORDER BY contract, token_id, owner
        LIMIT $/limit/
      `;

      nftBalances = await redb.manyOrNone(totalRemainingSupplyQuery, values);
      continuation = `AND (contract, token_id, owner) > ($/lastContract/, $/lastTokenId/, $/lastOwner/)`;

      if (!_.isEmpty(nftBalances)) {
        nftBalances.map(
          (event) => (remainingSupply = bn(event.amount).add(remainingSupply).toString())
        );

        const lastBalance = _.last(nftBalances);
        values.lastContract = lastBalance.contract;
        values.lastTokenId = lastBalance.token_id;
        values.lastOwner = lastBalance.owner;
      }
    } while (nftBalances.length >= limit);

    return remainingSupply;
  }

  public async calcTotalSupply(contract: string, tokenId: string) {
    const limit = 1000;
    let totalSupply = "0";
    let continuation = "";
    let transferEvents = [];

    const values: {
      contract: Buffer;
      tokenId: string;
      mintAddresses: Buffer[];
      limit: number;
      lastTimestamp?: string;
      lastTxHash?: Buffer;
      lastLogIndex?: number;
      lastBatchIndex?: number;
    } = {
      contract: toBuffer(contract),
      tokenId: tokenId,
      mintAddresses: [AddressZero].map((address) => toBuffer(address)),
      limit,
    };

    do {
      const totalSupplyQuery = `
        SELECT amount, "timestamp", tx_hash, log_index, batch_index
        FROM nft_transfer_events
        WHERE address = $/contract/
        AND token_id = $/tokenId/
        AND nft_transfer_events.from IN ($/mintAddresses:list/)
        AND is_deleted = 0
        ${continuation}
        ORDER BY "timestamp", tx_hash, log_index, batch_index
        LIMIT $/limit/
      `;

      transferEvents = await redb.manyOrNone(totalSupplyQuery, values);
      continuation = `AND ("timestamp", tx_hash, log_index, batch_index) > ($/lastTimestamp/, $/lastTxHash/, $/lastLogIndex/, $/lastBatchIndex/)`;

      if (!_.isEmpty(transferEvents)) {
        transferEvents.map((event) => (totalSupply = bn(event.amount).add(totalSupply).toString()));

        const lastEvent = _.last(transferEvents);
        values.lastTimestamp = lastEvent.timestamp;
        values.lastTxHash = lastEvent.tx_hash;
        values.lastLogIndex = lastEvent.log_index;
        values.lastBatchIndex = lastEvent.batch_index;
      }
    } while (transferEvents.length >= limit);

    return totalSupply;
  }

  public async addToQueue(tokens: TokenRecalcSupplyPayload[], delay = 60 * 5 * 1000) {
    await this.sendBatch(
      tokens.map((t) => ({ payload: t, jobId: `${t.contract}:${t.tokenId}`, delay }))
    );
  }
}

export const tokenReclacSupplyJob = new TokenReclacSupplyJob();
