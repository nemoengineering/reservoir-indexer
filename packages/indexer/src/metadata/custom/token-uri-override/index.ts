/* eslint-disable @typescript-eslint/no-explicit-any */

export const fetchTokenUri = ({ contract, tokenId }: { contract: string; tokenId: string }) => {
  if (contract === "0x7f51575f486e26f83e575a3fe77db71032e4d124") {
    return `https://arweave.net/Q84TLEaVUIRTqgkpXz2G2JK9CPWza1fVxfTW8lcWaWM/${tokenId}`;
  }

  if (contract === "0x9a6c24fe29c70d41bcc3099c4b40dac930372e22") {
    return `https://arweave.net/cF6Mk4dYId7VgsNzXZaHLvIIUwA8XHIXWCr_p9NAW0I/${tokenId}`;
  }

  if (contract === "0x5dd728c82ac5168cfbd4281b4df530b9c2103c17") {
    return `https://bafybeidiog5pneo47l4rfx4zmcldfgchvgsvssu3ndywhpvao5rn574cpi.ipfs.dweb.link/metadata/${tokenId}`;
  }

  if (contract === "0xcf57971769e2abe438c9644655bd7ae0f2f9fec8") {
    return `https://arweave.net/VzPB0wVG_xjYtl3WDQXXvaK86WBEnoLQXJfpE7lvQOQ/${tokenId}`;
  }

  if (contract === "0xe73d273406546e31de2f3f43c533badce9c51927") {
    return `https://arweave.net/v56OB8FLcX2kg1zz1dDxDkZJq0-PjAFdzOtgoax00p8/${tokenId}`;
  }

  if (contract === "0x2156cbde96b23c0d7b45b1558fff94ff0fe624e9") {
    return `https://arweave.net/zp3_5-5v0XLwFFNfYBTLEP31g63GthtFjCkSAAWwZM0/${tokenId}`;
  }

  if (contract === "0xe8835036f4007a9781820c62c487d592ad9801be") {
    return `https://ipfs.io/ipfs/QmdqcrPVQSDGpe2x9wR6ve2TL6rSeWboLtAYmS5TaZnMjp/${tokenId}.json`;
  }

  if (contract === "0x025776f8aec3f445a64fea642cd7776302157815") {
    return `https://shdw-drive.genesysgo.net/F2EQQBTeTdFwExmYpa4bKF4Ds31bhWZfHnb9SXJRfadi/${tokenId}`;
  }

  if (contract === "0x75e9ea2c01b0ce74c22f0e5d02cec57d8e5abe81") {
    return `https://arweave.net/980AB4mK5nPaYZyIQVWswZ13izlM5MZwBgnzKpiaF3Q/${tokenId}`;
  }

  if (contract === "0x810a9d701d187fa7991659ca97279fbd49dee8eb") {
    return `https://arweave.net/U-GD2n2oeVlVxyTaoGrBW2TpRcw0rzEKc8b24d5Hzz0/${tokenId}`;
  }

  if (contract === "0x69af78a0973b8901cd04595c15e1a2a11a36bf09") {
    return `https://arweave.net/n05eqbJgDi08h6wp-Z6gg1FlB2qYV95Av7wLn3AjxhQ/${tokenId}`;
  }

  if (contract === "0x33962384ea96fffd38981bcab9e84ebb9ce111f9") {
    return `https://arweave.net/aOERr36qxv0iapb9IhzD7Pz3mo6KxClTLN7P9YNFkGA/${tokenId}`;
  }

  if (contract === "0x0b9b247af870803fd01670f1c3e475c9d7629079") {
    return `https://backend.seimutants.xyz/public/tokenUri/${tokenId}`;
  }

  if (contract === "0xf06193db0ba689cd35245bed13a0b6bb7ead327c") {
    return `https://nft.boringyachts.xyz/api/nft/${tokenId}`;
  }

  if (contract === "0x255aeab912e9475207c3a08ffe0c0b91fa85667a") {
    return `https://www.okx.com/priapi/v1/nft/metadata/137/0x255aeab912e9475207c3a08ffe0c0b91fa85667a/${tokenId}`;
  }
};
