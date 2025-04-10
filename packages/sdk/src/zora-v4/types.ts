export type OrderParams = {
  pool: string;
  price: string;
  side: "buy" | "sell";
  collection: string;
  tokenId: string;
  extra?: {
    prices: string[];
  };
};
