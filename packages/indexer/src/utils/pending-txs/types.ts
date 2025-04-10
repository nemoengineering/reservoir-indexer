export type ReceivedMessage = {
  type: "newTx" | "pendingTx";
  data: PendingMessage;
};

export type PendingMessage = {
  txHash: string;
  txContents: {
    input: string;
    from: string;
    to: string;
    value: string;
  };
  time: string;
};

export type PendingToken = {
  contract: string;
  tokenId: string;
};

export type PendingItem = PendingToken & {
  txHash: string;
  createdAt: string;
  updatedAt: string;
  originatedAt: string;
};
