/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { config } from "@/config/index";
import * as yugaLabs from "./yuga-labs";
import * as bridgeToBase from "./bridge-to-base";
import * as mintTest from "./mint-test";
import * as dojicrew from "./dojicrew";
import * as azuki from "./azuki";
import * as veeFriends from "./vee-friends";
import * as tsuruOnBase from "./tsuru-on-base";
import * as superFrens from "./super-frens";
import * as tokenUriOverride from "./token-uri-override";

const customCollection: { [key: string]: any } = {};
const custom: { [key: string]: any } = {};
const customTokenUri: { [key: string]: any } = {};
const customTokenUriMetadata: { [key: string]: any } = {};

export const hasCustomCollectionHandler = (contract: string) =>
  Boolean(customCollection[`${config.chainId},${contract}`]);

export const hasCustomHandler = (contract: string) =>
  Boolean(custom[`${config.chainId},${contract}`]);

export const hasCustomTokenUriMetadataHandler = (contract: string) =>
  Boolean(customTokenUriMetadata[`${config.chainId},${contract}`]);

export const hasCustomTokenUri = (contract: string) =>
  Boolean(customTokenUri[`${config.chainId},${contract}`]);

// All of the below methods assume the caller ensured that a custom
// handler exists (eg. via calling the above check methods)

export const customHandleCollection = async (token: any) =>
  customCollection[`${config.chainId},${token.contract}`].fetchCollection(token);

export const customHandleToken = async (token: any) =>
  custom[`${config.chainId},${token.contract}`].fetchToken(token);

export const customHandleContractTokens = async (contract: string, continuation: string) =>
  custom[`${config.chainId},${contract}`].fetchContractTokens(null, continuation);

export const customFetchTokenUriMetadata = async (token: any, uri: string) =>
  customTokenUriMetadata[`${config.chainId},${token.contract}`].fetchTokenUriMetadata(token, uri);

export const customFetchTokenUri = (token: any): string =>
  customTokenUri[`${config.chainId},${token.contract}`].fetchTokenUri(token);

////////////////
// Custom Tokens
////////////////

// Yuga Labs
customTokenUriMetadata["1,0xe012baf811cf9c05c408e879c399960d1f305903"] = yugaLabs;
customTokenUriMetadata["1,0x60e4d786628fea6478f785a6d7e704777c86a7c6"] = yugaLabs;

// Bridge to Base
custom["8453,0xea2a41c02fa86a4901826615f9796e603c6a4491"] = bridgeToBase;

// Mint test
custom["999,0xe6a65c982ffa589a934fa93ab59e6e9646f25763"] = mintTest;

// Azuki
customTokenUriMetadata["137,0xc1c2144b3e4e22f4205545e965f52ebc77a1c952"] = azuki;
customTokenUriMetadata["137,0xa45b6fb131e9fae666898a64be132e1a78fb7394"] = azuki;
customTokenUriMetadata["137,0xa81ac7a8b848ad22e80a1078b5a47f646c1c4510"] = azuki;
customTokenUriMetadata["137,0xf13e1ed539cbbb305f2a460fad81519b7748b0a9"] = azuki;
customTokenUriMetadata["1,0x3c3d5e05fb83be9ba9c85c72cfb6a82174eacec2"] = azuki;

// Vee Friends
customTokenUriMetadata["11155111,0x901f7cfc8a99a5978a766ddc1c790a6623f3940b"] = veeFriends;

// Tsuru On Base
custom["8453,0xc7cd9b38cc75296e9246aabad6fc58ff979eb08e"] = tsuruOnBase;

// SuperFrens
customTokenUriMetadata["8453,0x9c451e5f05c03cefc30404dfd193788799c58c7a"] = superFrens;

// dojicrew
custom["1,0x5e9dc633830af18aa43ddb7b042646aadedcce81"] = dojicrew;

// tokenUriOverride
customTokenUri["1329,0x7f51575f486e26f83e575a3fe77db71032e4d124"] = tokenUriOverride;
customTokenUri["1329,0x9a6c24fe29c70d41bcc3099c4b40dac930372e22"] = tokenUriOverride;
customTokenUri["1329,0x5dd728c82ac5168cfbd4281b4df530b9c2103c17"] = tokenUriOverride;
customTokenUri["1329,0xcf57971769e2abe438c9644655bd7ae0f2f9fec8"] = tokenUriOverride;
customTokenUri["1329,0xe73d273406546e31de2f3f43c533badce9c51927"] = tokenUriOverride;
customTokenUri["1329,0x2156cbde96b23c0d7b45b1558fff94ff0fe624e9"] = tokenUriOverride;
customTokenUri["1329,0xe8835036f4007a9781820c62c487d592ad9801be"] = tokenUriOverride;
customTokenUri["1329,0x025776f8aec3f445a64fea642cd7776302157815"] = tokenUriOverride;
customTokenUri["1329,0x75e9ea2c01b0ce74c22f0e5d02cec57d8e5abe81"] = tokenUriOverride;
customTokenUri["1329,0x810a9d701d187fa7991659ca97279fbd49dee8eb"] = tokenUriOverride;
customTokenUri["1329,0x69af78a0973b8901cd04595c15e1a2a11a36bf09"] = tokenUriOverride;
customTokenUri["1329,0x33962384ea96fffd38981bcab9e84ebb9ce111f9"] = tokenUriOverride;
customTokenUri["1329,0x0b9b247af870803fd01670f1c3e475c9d7629079"] = tokenUriOverride;
customTokenUri["33139,0xf06193db0ba689cd35245bed13a0b6bb7ead327c"] = tokenUriOverride;
customTokenUri["137,0x255aeab912e9475207c3a08ffe0c0b91fa85667a"] = tokenUriOverride;
