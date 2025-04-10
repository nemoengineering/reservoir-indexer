import { RouteOptions } from "@hapi/hapi";
import swagger2openapi from "swagger2openapi";

import { inject } from "@/api/index";
import { logger } from "@/common/logger";

// eslint-disable-next-line
const parseMethod = (object: { [key: string]: any }) => {
  if (object["get"]) {
    return object["get"];
  } else if (object["post"]) {
    return object["post"];
  } else if (object["put"]) {
    return object["put"];
  } else if (object["delete"]) {
    return object["delete"];
  }
};

// eslint-disable-next-line
const getMethod = (object: { [key: string]: any }) => {
  if (object["get"]) {
    return "get";
  } else if (object["post"]) {
    return "post";
  } else if (object["put"]) {
    return "put";
  } else if (object["delete"]) {
    return "delete";
  }
};

let openapiData: object;

export const generateOpenApiSpec = async () => {
  try {
    const response = await inject({
      method: "GET",
      url: "/swagger.json",
    });

    const swagger = JSON.parse(response.payload);

    const data = await swagger2openapi.convertObj(swagger, {
      patch: true,
      warnOnly: true,
    });

    data.openapi["servers"] = [
      {
        url: "https://api.reservoir.tools",
        description: "Ethereum",
      },
      {
        url: "https://api-polygon.reservoir.tools",
        description: "Polygon",
      },
      {
        url: "https://api-base.reservoir.tools",
        description: "Base",
      },
      {
        url: "https://api-abstract.reservoir.tools",
        description: "Abstract",
      },
      {
        url: "https://api-abstract-testnet.reservoir.tools",
        description: "Abstract Testnet",
      },
      {
        url: "https://api-ancient8.reservoir.tools",
        description: "Ancient8",
      },
      {
        url: "https://api-ancient8-testnet.reservoir.tools",
        description: "Ancient8 Testnet",
      },
      {
        url: "https://api-anime-testnet.reservoir.tools",
        description: "Anime Testnet",
      },
      {
        url: "https://api-apechain.reservoir.tools",
        description: "Apechain",
      },
      {
        url: "https://api-apex.reservoir.tools",
        description: "Apex",
      },
      {
        url: "https://api-apex-testnet.reservoir.tools",
        description: "Apex Testnet",
      },
      {
        url: "https://api-arbitrum.reservoir.tools",
        description: "Arbitrum",
      },
      {
        url: "https://api-arbitrum-nova.reservoir.tools",
        description: "Arbitrum Nova",
      },
      {
        url: "https://api-astar-zkevm.reservoir.tools",
        description: "Astar zkEVM",
      },
      {
        url: "https://api-avalanche.reservoir.tools",
        description: "Avalanche",
      },
      {
        url: "https://api-amoy.reservoir.tools",
        description: "Amoy",
      },
      {
        url: "https://api-base-sepolia.reservoir.tools",
        description: "Base Sepolia",
      },
      {
        url: "https://api-berachain.reservoir.tools",
        description: "Berachain",
      },
      {
        url: "https://api-berachain-testnet.reservoir.tools",
        description: "Berachain Testnet",
      },
      {
        url: "https://api-b3.reservoir.tools",
        description: "B3",
      },
      {
        url: "https://api-b3-testnet.reservoir.tools",
        description: "B3 Testnet",
      },
      {
        url: "https://api-bitlayer.reservoir.tools",
        description: "Bitlayer",
      },
      {
        url: "https://api-blast.reservoir.tools",
        description: "Blast",
      },
      {
        url: "https://api-blast-sepolia.reservoir.tools",
        description: "Blast Sepolia",
      },
      {
        url: "https://api-boss.reservoir.tools",
        description: "Boss",
      },
      {
        url: "https://api-bsc.reservoir.tools",
        description: "Binance Smart Chain",
      },
      {
        url: "https://api-cloud.reservoir.tools",
        description: "Cloud",
      },
      {
        url: "https://api-creator-testnet.reservoir.tools",
        description: "Creator Testnet",
      },
      {
        url: "https://api-curtis.reservoir.tools",
        description: "Curtis",
      },
      {
        url: "https://api-cyber.reservoir.tools",
        description: "Cyber",
      },
      {
        url: "https://api-degen.reservoir.tools",
        description: "Degen",
      },
      {
        url: "https://api-flow.reservoir.tools",
        description: "Flow",
      },
      {
        url: "https://api-forma.reservoir.tools",
        description: "Forma",
      },
      {
        url: "https://api-forma-sketchpad.reservoir.tools",
        description: "Forma Sketchpad",
      },
      {
        url: "https://api-frame-testnet.reservoir.tools",
        description: "Frame Testnet",
      },
      {
        url: "https://api-game7.reservoir.tools",
        description: "Game7",
      },
      {
        url: "https://api-game7-testnet.reservoir.tools",
        description: "Game7 Testnet",
      },
      {
        url: "https://api-hychain.reservoir.tools",
        description: "Hychain",
      },
      {
        url: "https://api-hychain-testnet.reservoir.tools",
        description: "Hychain Testnet",
      },
      {
        url: "https://api-ink.reservoir.tools",
        description: "Ink",
      },
      {
        url: "https://api-linea.reservoir.tools",
        description: "Linea",
      },
      {
        url: "https://api-minato.reservoir.tools",
        description: "Minato",
      },
      {
        url: "https://api-monad-testnet.reservoir.tools",
        description: "Monad Testnet",
      },
      {
        url: "https://api-nebula.reservoir.tools",
        description: "Nebula",
      },
      {
        url: "https://api-opbnb.reservoir.tools",
        description: "OPBNB",
      },
      {
        url: "https://api-optimism.reservoir.tools",
        description: "Optimism",
      },
      {
        url: "https://api-polygon-zkevm.reservoir.tools",
        description: "Polygon zkEVM",
      },
      {
        url: "https://api-redstone.reservoir.tools",
        description: "Redstone",
      },
      {
        url: "https://api-scroll.reservoir.tools",
        description: "Scroll",
      },
      {
        url: "https://api-sei.reservoir.tools",
        description: "Sei",
      },
      {
        url: "https://api-sei-testnet.reservoir.tools",
        description: "Sei Testnet",
      },
      {
        url: "https://api-sepolia.reservoir.tools",
        description: "Sepolia",
      },
      {
        url: "https://api-shape.reservoir.tools",
        description: "Shape",
      },
      {
        url: "https://api-shape-sepolia.reservoir.tools",
        description: "Shape Sepolia",
      },
      {
        url: "https://api-soneium.reservoir.tools",
        description: "Soneium",
      },
      {
        url: "https://api-story-odyssey.reservoir.tools",
        description: "Story Odyssey",
      },
      {
        url: "https://api-xai.reservoir.tools",
        description: "Xai",
      },
      {
        url: "https://api-zero.reservoir.tools",
        description: "Zero",
      },
      {
        url: "https://api-zero-testnet.reservoir.tools",
        description: "Zero Testnet",
      },
      {
        url: "https://api-zksync.reservoir.tools",
        description: "zkSync",
      },
      {
        url: "https://api-zora.reservoir.tools",
        description: "Zora",
      },
    ];

    // Preset list of tags.
    const tagOrder = [
      "Tokens",
      "Collections",
      "Attributes",
      "Activity",
      "Orders",
      "Sales",
      "Transfers",
      "Events",
      "Owners",
      "Stats",
      "Sources",
      "Chain",
    ];

    data.openapi["paths"] = Object.fromEntries(
      // eslint-disable-next-line
      Object.entries(data.openapi["paths"]).sort((a: any, b: any) => {
        const aMethod = parseMethod(a[1]);
        const bMethod = parseMethod(b[1]);

        aMethod["tags"] = aMethod["tags"] ? aMethod["tags"] : [];
        bMethod["tags"] = bMethod["tags"] ? bMethod["tags"] : [];

        // Get the index of the tags in the preset array.
        let aTagIndex = tagOrder.indexOf(aMethod["tags"][0]);
        let bTagIndex = tagOrder.indexOf(bMethod["tags"][0]);

        // If a tag doesn't exist in the preset array, give it a high index.
        if (aTagIndex === -1) {
          aTagIndex = tagOrder.length;
        }

        if (bTagIndex === -1) {
          bTagIndex = tagOrder.length;
        }

        // Compare the indices of the tags in the preset array.
        if (aTagIndex < bTagIndex) {
          return -1;
        }

        if (aTagIndex > bTagIndex) {
          return 1;
        }

        return 0;
      })
    );

    data.openapi["paths"] = Object.fromEntries(
      // eslint-disable-next-line
      Object.entries(data.openapi["paths"]).map((path: any) => {
        const pathMethod = parseMethod(path[1]);

        if (pathMethod.parameters?.length) {
          for (const parameter of pathMethod.parameters) {
            const parameterDefault = parameter.schema?.default;

            if (parameterDefault !== undefined) {
              delete parameter.schema.default;
              const defaultDescription = `defaults to **${parameterDefault}**`;

              parameter.description = parameter.description
                ? `${parameter.description} ${defaultDescription}`
                : defaultDescription;
            }
          }

          path[1][getMethod(path[1])!] = pathMethod;
        }

        return path;
      })
    );

    openapiData = data.openapi;
  } catch (e) {
    logger.error("generation-openapi-spec", `generate openapi spec error: ${e}`);
  }
};

export const getOpenApiOptions: RouteOptions = {
  description: "Get swagger json in OpenApi V3",
  tags: ["api", "x-admin"],
  timeout: {
    server: 10 * 1000,
  },
  handler: async () => {
    try {
      if (!openapiData) {
        await generateOpenApiSpec();
      }

      return openapiData;
    } catch (error) {
      logger.error("get-open-api-handler", `Handler failure: ${error}`);
      throw error;
    }
  },
};
