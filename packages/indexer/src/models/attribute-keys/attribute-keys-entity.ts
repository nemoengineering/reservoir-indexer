// Define the fields we can update
export type AttributeKeysEntityParamsUpdateParams = {
  attributeCount?: number;
};

export type AttributeKeysEntityParams = {
  id: number;
  collection_id: string;
  key: string;
  kind: string;
  rank: number;
  attribute_count: number;
  info: AttributeKeysInfo | null;
  created_at: string;
  updated_at: string;
};

export type AttributeKeysInfo = {
  min_range?: number | undefined;
  max_range?: number | undefined;
};

export class AttributeKeysEntity {
  id: number;
  collectionId: string;
  key: string;
  kind: string;
  rank: number;
  attributeCount: number;
  info: AttributeKeysInfo | null;
  createdAt: string;
  updatedAt: string;

  constructor(params: AttributeKeysEntityParams) {
    this.id = params.id;
    this.collectionId = params.collection_id;
    this.key = params.key;
    this.kind = params.kind;
    this.rank = params.rank;
    this.attributeCount = params.attribute_count;
    this.info = params.info;
    this.createdAt = params.created_at;
    this.updatedAt = params.updated_at;
  }
}
