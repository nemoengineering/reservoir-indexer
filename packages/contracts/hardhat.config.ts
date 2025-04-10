import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "hardhat-gas-reporter";
import "hardhat-tracer";

// For zkSync
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";

const getNetworkConfig = (chainId?: number) => {
  if (!chainId) {
    chainId = Number(process.env.CHAIN_ID ?? 1);
  }

  let url = process.env.RPC_URL;
  if (!url) {
    switch (chainId) {
      // Mainnets
      case 1:
        url = "https://rpc.mevblocker.io";
        break;
      case 10:
        url = "https://mainnet.optimism.io/";
        break;
      case 56:
        url = "https://bsc-dataseed1.bnbchain.org";
        break;
      case 137:
        url = "https://rpc-mainnet.matic.quiknode.pro";
        break;
      case 204:
        url = "https://opbnb-mainnet-rpc.bnbchain.org";
        break;
      case 324:
        url = "https://mainnet.era.zksync.io";
        break;
      case 360:
        url = "https://mainnet.shape.network";
        break;
      case 690:
        url = "https://rpc.redstonechain.com";
        break;
      case 747:
        url = "https://mainnet.evm.nodes.onflow.org";
        break;
      case 1101:
        url = "https://zkevm-rpc.com";
        break;
      case 1329:
        url = "https://evm-rpc.sei-apis.com";
        break;
      case 1868:
        url = "https://rpc.soneium.org";
        break;
      case 2187:
        url = "https://mainnet-rpc.game7.io";
        break;
      case 2741:
        url = "https://api.raas.matterhosted.dev/";
        break;
      case 2911:
        url = "https://rpc.hychain.com/http";
        break;
      case 3776:
        url = "https://rpc.startale.com/astar-zkevm";
        break;
      case 7560:
        url = "https://cyber.alt.technology";
        break;
      case 8333:
        url = "https://mainnet-rpc.b3.fun/http";
        break;
      case 8453:
        url = "https://developer-access-mainnet.base.org";
        break;
      case 17069:
        url = "https://rpc.garnet.qry.live";
        break;
      case 42161:
        url = "https://arb1.arbitrum.io/rpc";
        break;
      case 42170:
        url = "https://arbitrum-nova.publicnode.com";
        break;
      case 43114:
        url = "https://avalanche-c-chain.publicnode.com";
        break;
      case 57073:
        url = "https://rpc-gel.inkonchain.com";
        break;
      case 59144:
        url = "https://rpc.linea.build";
        break;
      case 69000:
        url = "https://rpc-animechain-39xf6m45e3.t.conduit.xyz";
        break;
      case 70700:
        url = "https://rpc.apex.proofofplay.com";
        break;
      case 70701:
        url = "https://rpc.boss.proofofplay.com";
        break;
      case 80094:
        url = "";
      case 81457:
        url = "https://blast.blockpi.network/v1/rpc/public";
        break;
      case 200901:
        url = "https://rpc.bitlayer.org";
        break;
      case 534352:
        url = "https://rpc.scroll.io";
        break;
      case 543210:
        url = "https://zero-network.calderachain.xyz";
        break;
      case 660279:
        url = "https://xai-chain.net/rpc";
        break;
      case 984122:
        url = "https://rpc.forma.art";
        break;
      case 7777777:
        url = "https://rpc.zora.energy";
        break;
      case 666666666:
        url = "https://rpc.degen.tips";
        break;
      case 888888888:
        url = "https://rpc.ancient8.gg/";
        break;
      case 1482601649:
        url = "https://mainnet.skalenodes.com/v1/green-giddy-denebola";
        break;
      // Testnets
      case 4654:
        url = "https://creator-testnet.rpc.caldera.xyz/http";
        break;
      case 646:
        url = "https://previewnet.evm.nodes.onflow.org";
        break;
      case 1516:
        url = "https://rpc.odyssey.storyrpc.io/";
        break;
      case 1946:
        url = "https://rpc.minato.soneium.org/";
        break;
      case 1993:
        url = "https://sepolia.b3.fun/http";
        break;
      case 5001:
        url = "https://rpc.testnet.mantle.xyz";
        break;
      case 6900:
        url = "https://rpc-animechain-testnet-i8yja6a1a0.t.conduit.xyz";
        break;
      case 10143:
        url = "https://rpc.monad-testnet.category.xyz/rpc";
        break;
      case 11011:
        url = "https://sepolia.shape.network";
        break;
      case 11124:
        url = "https://api.testnet.abs.xyz";
        break;
      case 13746:
        url = "https://rpc-game7-testnet-0ilneybprf.t.conduit.xyz";
        break;
      case 29112:
        url = "https://testnet-rpc.hychain.com/http";
        break;
      case 33111:
        url = "https://curtis.rpc.caldera.xyz/http";
        break;
      case 33139:
        url = "https://apechain.calderachain.xyz/http";
        break;
      case 43210:
        url = "https://zerion-testnet-proofs.rpc.caldera.xyz/http";
        break;
      case 70800:
        url = "https://rpc-pop-testnet-barret-oxaolmcfss.t.conduit.xyz";
        break;
      case 70805:
        url = "https://rpc-pop-testnet-cloud-fmg1z6e0a9.t.conduit.xyz";
        break;
      case 80002:
        url = "https://rpc-amoy.polygon.technology";
        break;
      case 80084:
        url = "https://bartio.rpc.berachain.com/";
        break;
      case 84532:
        url = "https://sepolia.base.org";
        break;
      case 713715:
        url = "https://evm-rpc-arctic-1.sei-apis.com";
        break;
      case 984123:
        url = "https://rpc.sketchpad-1.forma.art";
        break;
      case 11155111:
        url = "https://1rpc.io/sepolia";
        break;
      case 28122024:
        url = "https://rpcv2-testnet.ancient8.gg/";
        break;
      case 168587773:
        url = "https://sepolia.blast.io";
        break;
      default:
        throw new Error("Unsupported chain id");
    }
  }

  const config = {
    chainId,
    url,
    accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : undefined,
  };

  // For zkSync
  if (chainId === 324 || chainId === 543210 || chainId === 2741) {
    return {
      ...config,
      ethNetwork: "mainnet",
      zksync: true,
    };
  } else if (chainId === 11124 || chainId === 43210 || chainId === 4654) {
    return {
      ...config,
      ethNetwork: "sepolia",
      zksync: true,
    };
  }

  return config;
};

const networkConfig = getNetworkConfig();
const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    // Devnets
    hardhat: {
      hardfork: "cancun",
      chainId: networkConfig.chainId,
      forking: {
        url: networkConfig.url,
        blockNumber: process.env.BLOCK_NUMBER ? Number(process.env.BLOCK_NUMBER) : undefined,
      },
      accounts: {
        // Custom mnemonic so that the wallets have no initial state
        mnemonic:
          "void forward involve old phone resource sentence fall friend wait strike copper urge reduce chapter",
      },
    },
    localhost: {
      chainId: networkConfig.chainId,
      url: "http://127.0.0.1:8545",
    },
    // Mainnets
    mainnet: getNetworkConfig(1),
    optimism: getNetworkConfig(10),
    bsc: getNetworkConfig(56),
    polygon: getNetworkConfig(137),
    opBnb: getNetworkConfig(204),
    zkSync: getNetworkConfig(324),
    redstone: getNetworkConfig(690),
    polygonZkevm: getNetworkConfig(1101),
    astarZkevm: getNetworkConfig(3776),
    cyber: getNetworkConfig(7560),
    base: getNetworkConfig(8453),
    garnet: getNetworkConfig(17069),
    arbitrum: getNetworkConfig(42161),
    arbitrumNova: getNetworkConfig(42170),
    avalanche: getNetworkConfig(43114),
    linea: getNetworkConfig(59144),
    apex: getNetworkConfig(70700),
    boss: getNetworkConfig(70701),
    blast: getNetworkConfig(81457),
    bitlayer: getNetworkConfig(200901),
    scroll: getNetworkConfig(534352),
    xai: getNetworkConfig(660279),
    zora: getNetworkConfig(7777777),
    degen: getNetworkConfig(666666666),
    ancient8: getNetworkConfig(888888888),
    nebula: getNetworkConfig(1482601649),
    sei: getNetworkConfig(1329),
    forma: getNetworkConfig(984122),
    b3: getNetworkConfig(8333),
    shape: getNetworkConfig(360),
    apechain: getNetworkConfig(33139),
    hychain: getNetworkConfig(2911),
    flow: getNetworkConfig(747),
    zero: getNetworkConfig(543210),
    abstract: getNetworkConfig(2741),
    game7: getNetworkConfig(2187),
    soneium: getNetworkConfig(1868),
    ink: getNetworkConfig(57073),
    berachain: getNetworkConfig(80094),
    anime: getNetworkConfig(69000),
    // Testnets
    flowPreviewnet: getNetworkConfig(646),
    b3Testnet: getNetworkConfig(1993),
    mantleTestnet: getNetworkConfig(5001),
    game7Testnet: getNetworkConfig(13746),
    apexTestnet: getNetworkConfig(70800),
    cloud: getNetworkConfig(70805),
    amoy: getNetworkConfig(80002),
    berachainTestnet: getNetworkConfig(80084),
    baseSepolia: getNetworkConfig(84532),
    seiTestnet: getNetworkConfig(713715),
    sepolia: getNetworkConfig(11155111),
    ancient8Testnet: getNetworkConfig(28122024),
    blastSepolia: getNetworkConfig(168587773),
    formaSketchpad: getNetworkConfig(984123),
    abstractTestnet: getNetworkConfig(11124),
    curtis: getNetworkConfig(33111),
    shapeSepolia: getNetworkConfig(11011),
    minato: getNetworkConfig(1946),
    hychainTestnet: getNetworkConfig(29112),
    zeroTestnetProofs: getNetworkConfig(43210),
    animeTestnet: getNetworkConfig(6900),
    creatorTestnet: getNetworkConfig(4654),
    storyOdyssey: getNetworkConfig(1516),
    monadTestnet: getNetworkConfig(10143),
  },
  etherscan: {
    apiKey: {
      // Mainnets
      mainnet: process.env.ETHERSCAN_API_KEY_ETHEREUM ?? "",
      optimisticEthereum: process.env.ETHERSCAN_API_KEY_OPTIMISM ?? "",
      bsc: process.env.ETHERSCAN_API_KEY_BSC ?? "",
      polygon: process.env.ETHERSCAN_API_KEY_POLYGON ?? "",
      zkSync: "0x",
      astarZkevm: "0x",
      polygonZkevm: process.env.ETHERSCAN_API_KEY_POLYGON_ZKEVM ?? "",
      base: process.env.ETHERSCAN_API_KEY_BASE ?? "",
      arbitrumOne: process.env.ETHERSCAN_API_KEY_ARBITRUM ?? "",
      arbitrumNova: process.env.ETHERSCAN_API_KEY_ARBITRUM_NOVA ?? "",
      avalanche: "0x",
      linea: process.env.ETHERSCAN_API_KEY_LINEA ?? "",
      scroll: process.env.ETHERSCAN_API_KEY_SCROLL ?? "",
      zora: "0x",
      ancient8: "0x",
      opBnb: "0x",
      apex: "0x",
      blast: process.env.ETHERSCAN_API_KEY_BLAST ?? "",
      bitlayer: "0x",
      degen: "0x",
      garnet: "0x",
      redstone: "0x",
      xai: "0x",
      nebula: "0x",
      cyber: "0x",
      sei: "0x",
      boss: "0x",
      forma: "0x",
      b3: "0x",
      shape: "0x",
      apechain: "0x",
      hychain: "0x",
      flow: "0x",
      zero: "0x",
      abstract: "0x",
      game7: "0x",
      soneium: "0x",
      ink: "0x",
      anime: "0x",
      // Testnets
      flowPreviewnet: "0x",
      b3Testnet: "0x",
      mantleTestnet: "0x",
      lineaTestnet: process.env.ETHERSCAN_API_KEY_LINEA_TESTNET ?? "",
      sepolia: process.env.ETHERSCAN_API_KEY_SEPOLIA ?? "",
      ancient8Testnet: "0x",
      baseSepolia: process.env.ETHERSCAN_API_KEY_BASE ?? "",
      blastSepolia: process.env.ETHERSCAN_API_KEY_BLAST ?? "",
      apexTestnet: "0x",
      berachainTestnet: "0x",
      amoy: "0x",
      seiTestnet: "0x",
      game7Testnet: "0x",
      cloud: "0x",
      formaSketchpad: "0x",
      abstractTestnet: "0x",
      curtis: "0x",
      shapeSepolia: "0x",
      minato: "0x",
      hychainTestnet: "0x",
      zeroTestnetProofs: "0x",
      animeTestnet: "0x",
      creatorTestnet: "0x",
      storyOdyssey: "0x",
      monadTestnet: "0x",
    },
    customChains: [
      // Mainnets
      {
        network: "opBnb",
        chainId: 204,
        urls: {
          apiURL: "https://api-opbnb.bscscan.com/api",
          browserURL: "https://opbnb.bscscan.com/",
        },
      },
      {
        network: "zkSync",
        chainId: 324,
        urls: {
          apiURL: "https://block-explorer-api.mainnet.zksync.io/api",
          browserURL: "https://explorer.zksync.io",
        },
      },
      {
        network: "shape",
        chainId: 360,
        urls: {
          apiURL: "https://internal-shaper-explorer.alchemypreview.com/api",
          browserURL: "https://internal-shaper-explorer.alchemypreview.com/",
        },
      },
      {
        network: "redstone",
        chainId: 690,
        urls: {
          apiURL: "https://api.explorer.redstonechain.com",
          browserURL: "https://explorer.redstone.xyz",
        },
      },
      {
        network: "polygonZkevm",
        chainId: 1101,
        urls: {
          apiURL: "https://api-zkevm.polygonscan.com/api",
          browserURL: "https://zkevm.polygonscan.com",
        },
      },
      {
        network: "astarZkevm",
        chainId: 3776,
        urls: {
          apiURL: "https://astar-zkevm.explorer.startale.com/api",
          browserURL: "https://astar-zkevm.explorer.startale.com",
        },
      },
      {
        network: "cyber",
        chainId: 7560,
        urls: {
          apiURL: "https://api.socialscan.io/cyber/v1/explorer/command_api/contract",
          browserURL: "https://cyber.socialscan.io",
        },
      },
      {
        network: "b3",
        chainId: 8333,
        urls: {
          apiURL: "https://explorer.b3.fun/api",
          browserURL: "https://explorer.b3.fun",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "garnet",
        chainId: 17069,
        urls: {
          apiURL: "https://api.explorer.garnet.qry.live",
          browserURL: "https://explorer.garnet.qry.live/",
        },
      },
      {
        network: "apechain",
        chainId: 33139,
        urls: {
          apiURL: "https://apechain.calderaexplorer.xyz/api",
          browserURL: "https://apechain.calderaexplorer.xyz/",
        },
      },
      {
        network: "arbitrumNova",
        chainId: 42170,
        urls: {
          apiURL: "https://api-nova.arbiscan.io/api",
          browserURL: "https://nova.arbiscan.io",
        },
      },
      {
        network: "avalanche",
        chainId: 43114,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
          browserURL: "https://avalanche.routescan.io",
        },
      },
      {
        network: "linea",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
      {
        network: "apex",
        chainId: 70700,
        urls: {
          apiURL: "https://explorer.apex.proofofplay.com/api",
          browserURL: "https://explorer.apex.proofofplay.com/",
        },
      },
      {
        network: "boss",
        chainId: 70701,
        urls: {
          apiURL: "https://explorer-proofofplay-boss-mainnet.t.conduit.xyz/api",
          browserURL: "https://explorer-proofofplay-boss-mainnet.t.conduit.xyz/",
        },
      },
      {
        network: "blast",
        chainId: 81457,
        urls: {
          apiURL: "https://api.blastscan.io/api",
          browserURL: "https://blastscan.io/",
        },
      },
      {
        network: "bitlayer",
        chainId: 200901,
        urls: {
          apiURL: "https://api.btrscan.com/scan/api",
          browserURL: "https://btrscan.com/",
        },
      },
      {
        network: "scroll",
        chainId: 534352,
        urls: {
          apiURL: "https://api.scrollscan.com/api",
          browserURL: "https://scrollscan.com",
        },
      },
      {
        network: "xai",
        chainId: 660279,
        urls: {
          apiURL: "https://explorer.xai-chain.net/api",
          browserURL: "https://explorer.xai-chain.net/",
        },
      },
      {
        network: "forma",
        chainId: 984122,
        urls: {
          apiURL: "https://explorer.forma.art/api",
          browserURL: "https://explorer.forma.art",
        },
      },
      {
        network: "zora",
        chainId: 7777777,
        urls: {
          apiURL: "https://explorer.zora.energy/api",
          browserURL: "https://explorer.zora.energy",
        },
      },
      {
        network: "degen",
        chainId: 666666666,
        urls: {
          apiURL: "https://explorer.degen.tips/api",
          browserURL: "https://explorer.degen.tips",
        },
      },
      {
        network: "ancient8",
        chainId: 888888888,
        urls: {
          apiURL: "https://scan.ancient8.gg/api",
          browserURL: "https://scan.ancient8.gg",
        },
      },
      {
        network: "nebula",
        chainId: 1482601649,
        urls: {
          apiURL: "https://green-giddy-denebola.explorer.mainnet.skalenodes.com/api",
          browserURL: "https://green-giddy-denebola.explorer.mainnet.skalenodes.com/",
        },
      },
      {
        network: "xai",
        chainId: 660279,
        urls: {
          apiURL: "https://explorer.xai-chain.net/api",
          browserURL: "https://explorer.xai-chain.net/",
        },
      },
      {
        network: "sei",
        chainId: 1329,
        urls: {
          apiURL: "https://seitrace.com/api",
          browserURL: "https://seitrace.com/",
        },
      },
      {
        network: "hychain",
        chainId: 2911,
        urls: {
          apiURL: "https://explorer.hychain.com/api",
          browserURL: "https://explorer.hychain.com",
        },
      },
      {
        network: "flow",
        chainId: 747,
        urls: {
          apiURL: "https://evm.flowscan.io/api",
          browserURL: "https://evm.flowscan.io",
        },
      },
      {
        network: "abstract",
        chainId: 2741,
        urls: {
          apiURL: "https://api-explorer-verify.raas.matterhosted.dev",
          browserURL: "https://explorer.mainnet.abs.xyz",
        },
      },
      {
        network: "game7",
        chainId: 2187,
        urls: {
          apiURL: "https://mainnet.game7.io/api/v2",
          browserURL: "https://mainnet.game7.io",
        },
      },
      {
        network: "soneium",
        chainId: 1868,
        urls: {
          apiURL: "https://vk9a3tgpne6qmub8.blockscout.com/api",
          browserURL: "https://vk9a3tgpne6qmub8.blockscout.com",
        },
      },
      {
        network: "ink",
        chainId: 57073,
        urls: {
          apiURL: "https://explorer.inkonchain.com/api",
          browserURL: "https://explorer.inkonchain.com",
        },
      },
      {
        network: "anime",
        chainId: 69000,
        urls: {
          apiURL: "https://explorer-animechain-39xf6m45e3.t.conduit.xyz/api",
          browserURL: "https://explorer-animechain-39xf6m45e3.t.conduit.xyz",
        },
      },
      // Testnets
      {
        network: "flowPreviewnet",
        chainId: 646,
        urls: {
          apiURL: "https://eth.flowscan.io/api",
          browserURL: "https://eth.flowscan.io",
        },
      },
      {
        network: "b3Testnet",
        chainId: 1993,
        urls: {
          apiURL: "https://sepolia.explorer.b3.fun/api",
          browserURL: "https://sepolia.explorer.b3.fun",
        },
      },
      {
        network: "mantleTestnet",
        chainId: 5001,
        urls: {
          apiURL: "https://explorer.testnet.mantle.xyz/api",
          browserURL: "https://explorer.testnet.mantle.xyz",
        },
      },
      {
        network: "game7Testnet",
        chainId: 13746,
        urls: {
          apiURL: "https://explorer-game7-testnet-0ilneybprf.t.conduit.xyz/api",
          browserURL: "https://explorer-game7-testnet-0ilneybprf.t.conduit.xyz",
        },
      },
      {
        network: "apexTestnet",
        chainId: 70800,
        urls: {
          apiURL: "https://explorerl2new-pop-testnet-barret-oxaolmcfss.t.conduit.xyz/api",
          browserURL: "https://explorerl2new-pop-testnet-barret-oxaolmcfss.t.conduit.xyz/",
        },
      },
      {
        network: "cloud",
        chainId: 70805,
        urls: {
          apiURL: "https://explorer-pop-testnet-cloud-fmg1z6e0a9.t.conduit.xyz/api",
          browserURL: "https://explorer-pop-testnet-cloud-fmg1z6e0a9.t.conduit.xyz",
        },
      },
      {
        network: "amoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://www.oklink.com/amoy",
        },
      },
      {
        network: "berachainTestnet",
        chainId: 80084,
        urls: {
          apiURL: "https://bartio.beratrail.io/api",
          browserURL: "https://bartio.beratrail.io/",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org/",
        },
      },
      {
        network: "seiTestnet",
        chainId: 713715,
        urls: {
          apiURL: "https://seitrace.com/api",
          browserURL: "https://seitrace.com/",
        },
      },
      {
        network: "formaSketchpad",
        chainId: 984123,
        urls: {
          apiURL: "https://explorer.sketchpad-1.forma.art/api",
          browserURL: "https://explorer.sketchpad-1.forma.art",
        },
      },
      {
        network: "ancient8Testnet",
        chainId: 28122024,
        urls: {
          apiURL: "https://scanv2-testnet.ancient8.gg/api",
          browserURL: "https://scanv2-testnet.ancient8.gg/",
        },
      },
      {
        network: "blastSepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api-sepolia.blastscan.io/api",
          browserURL: "https://sepolia.blastscan.io/",
        },
      },
      {
        network: "abstractTestnet",
        chainId: 11124,
        urls: {
          apiURL: "https://api-explorer-verify.testnet.abs.xyz/contract_verification",
          browserURL: "https://explorer.testnet.abs.xyz",
        },
      },
      {
        network: "curtis",
        chainId: 33111,
        urls: {
          apiURL: "https://curtis.explorer.caldera.xyz/api",
          browserURL: "https://curtis.explorer.caldera.xyz/",
        },
      },
      {
        network: "shapeSepolia",
        chainId: 11011,
        urls: {
          apiURL: "https://explorer-sepolia.shape.network/api",
          browserURL: "https://explorer-sepolia.shape.network/",
        },
      },
      {
        network: "minato",
        chainId: 1946,
        urls: {
          apiURL: "https://explorer-testnet.soneium.org/api",
          browserURL: "https://explorer-testnet.soneium.org/",
        },
      },
      {
        network: "hychainTestnet",
        chainId: 29112,
        urls: {
          apiURL: "https://testnet.explorer.hychain.com/api",
          browserURL: "https://testnet.explorer.hychain.com",
        },
      },
      {
        network: "zeroTestnetProofs",
        chainId: 43210,
        urls: {
          apiURL: "https://zerion-testnet-proofs.explorer.caldera.xyz/api",
          browserURL: "https://zerion-testnet-proofs.explorer.caldera.xyz",
        },
      },
      {
        network: "zero",
        chainId: 543210,
        urls: {
          apiURL: "https://zero-network.calderaexplorer.xyz/api",
          browserURL: "https://zero-network.calderaexplorer.xyz",
        },
      },
      {
        network: "animeTestnet",
        chainId: 6900,
        urls: {
          apiURL: "https://testnet-explorer.anime.xyz/api",
          browserURL: "https://testnet-explorer.anime.xyz",
        },
      },
      {
        network: "creatorTestnet",
        chainId: 4654,
        urls: {
          apiURL: "https://creator-testnet.explorer.caldera.xyz/api",
          browserURL: "https://creator-testnet.explorer.caldera.xyz",
        },
      },
      {
        network: "storyOdyssey",
        chainId: 1516,
        urls: {
          apiURL: "https://odyssey.storyscan.xyz/api",
          browserURL: "https://odyssey.storyscan.xyz",
        },
      },
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://explorer.monad-testnet.category.xyz/api",
          browserURL: "https://explorer.monad-testnet.category.xyz",
        },
      },
    ],
  },
  gasReporter: {
    enabled: Boolean(Number(process.env.REPORT_GAS)),
  },
  mocha: {
    timeout: 1000000,
  },
};

export default config;
