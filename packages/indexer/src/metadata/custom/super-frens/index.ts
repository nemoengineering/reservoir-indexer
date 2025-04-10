/* eslint-disable @typescript-eslint/no-explicit-any */

import axios from "axios";
import { handleTokenUriErrorResponse, handleTokenUriResponse } from "@/metadata/providers/utils";

export const fetchTokenUriMetadata = async (
  { contract, tokenId }: { contract: string; tokenId: string },
  uri: string
) => {
  if (uri.endsWith("SuperFrensJSON/")) {
    uri = `${uri}${tokenId}`;
  }

  return axios
    .get(uri)
    .then((res) => handleTokenUriResponse(contract, tokenId, res))
    .catch((error) => handleTokenUriErrorResponse(contract, tokenId, error));
};
