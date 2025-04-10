import { keccak256 } from "@ethersproject/solidity";
import { Permit, PermitHandler } from "@reservoir0x/sdk/dist/router/v6/permit";
import stringify from "json-stable-stringify";

import { idb } from "@/common/db";
import { baseProvider } from "@/common/provider";
import { redis } from "@/common/redis";
import { fromBuffer, toBuffer } from "@/common/utils";
import { config } from "@/config/index";

// Persistent permits

export const savePersistentPermit = async (permit: Permit, signature: string) => {
  await idb.none(
    `
      INSERT INTO permits(
        id,
        index,
        is_valid,
        kind,
        token,
        owner,
        spender,
        value,
        nonce,
        deadline,
        signature
      ) VALUES (
        $/id/,
        $/index/,
        $/isValid/,
        $/kind/,
        $/token/,
        $/owner/,
        $/spender/,
        $/value/,
        $/nonce/,
        $/deadline/,
        $/signature/
      )
      ON CONFLICT DO NOTHING
    `,
    {
      id: await new PermitHandler(config.chainId, baseProvider).hash(permit),
      index: 0,
      isValid: true,
      kind: permit.kind,
      token: toBuffer(permit.data.token),
      owner: toBuffer(permit.data.owner),
      spender: toBuffer(permit.data.spender),
      value: permit.data.amount,
      nonce: permit.data.nonce,
      deadline: permit.data.deadline,
      signature: toBuffer(signature),
    }
  );
};

export const getPersistentPermit = async (id: string, index = 0): Promise<Permit | undefined> => {
  const result = await idb.oneOrNone(
    `
      SELECT
        permits.*
      FROM permits
      WHERE permits.id = $/id/
        AND permits.index = $/index/
        AND permits.is_valid
    `,
    { id, index }
  );
  if (!result) {
    return undefined;
  }

  return {
    kind: "eip2612",
    data: {
      owner: fromBuffer(result.owner),
      spender: fromBuffer(result.spender),
      token: fromBuffer(result.token),
      amount: result.value,
      deadline: result.deadline,
      nonce: result.nonce,
      signature: fromBuffer(result.signature),
      transfers: [],
    },
  };
};

// Ephemeral permits

export const getEphemeralPermitId = (requestPayload: object, additionalData: object) => {
  // For some reason if the signature is added to the query parameters in the execute buy
  // call, it will also get included in the request payload - so here we just remove that

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((requestPayload as any).signature) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (requestPayload as any).signature;
  }

  return keccak256(["string"], [stringify({ requestPayload, additionalData })]);
};

export const saveEphemeralPermit = async (id: string, permit: Permit, expiresIn = 10 * 60) =>
  expiresIn === 0
    ? redis.set(id, JSON.stringify(permit), "KEEPTTL")
    : redis.set(id, JSON.stringify(permit), "EX", expiresIn);

export const getEphemeralPermit = async (id: string) =>
  redis.get(id).then((s) => (s ? (JSON.parse(s) as Permit) : undefined));
