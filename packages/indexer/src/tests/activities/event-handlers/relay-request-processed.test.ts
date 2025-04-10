import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { RelayRequestProcessedEventHandler } from "@/elasticsearch/indexes/activities/event-handlers/relay-request-processed";
import { config } from "../../../config";

jest.setTimeout(1000 * 1000);

describe("Activities - Event Handlers - Relay Request Processed", () => {
  it("generateActivity - Handle bridge request", async () => {
    const requestData = {
      id: "0x6265f0df1abbd9695db203d9c427f22e0bc44cc00100c4adec343d4f7e4dca90",
      status: "success",
      user: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
      recipient: "0xD032A2b161c5E4a3Fa62a4789FF6B1987CB9B3Af",
      data: {
        failReason: "N/A",
        fees: {
          gas: "2554097137200",
          fixed: "0",
          price: "24684140572",
        },
        feesUsd: {
          gas: "5860",
          fixed: "0",
          price: "56",
        },
        inTxs: [
          {
            fee: "1387070000000",
            data: {
              to: "0xa5f565650890fba1824ee0f21ebbbf660a179934",
              data: "0x033fc878",
              from: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
              value: "126000000000000",
            },
            stateChanges: [
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "-126000000000000",
                },
                address: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "126000000000000",
                },
                address: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              },
            ],
            hash: "0xa98273e707aee37e4a50efe454e49dda359c0953459aedf3f1dfa35174ef6639",
            type: "onchain",
            chainId: 42161,
            timestamp: 1726601675,
          },
        ],
        currency: "eth",
        currencyObject: {
          chainId: 42161,
          address: "0x0000000000000000000000000000000000000000",
          symbol: "ETH",
          name: "Ether",
          decimals: 18,
          metadata: {
            logoURI: "https://assets.relay.link/icons/1/light.png",
            verified: true,
            isNative: true,
          },
        },
        feeCurrency: "eth",
        feeCurrencyObject: {
          chainId: 42161,
          address: "0x0000000000000000000000000000000000000000",
          symbol: "ETH",
          name: "Ether",
          decimals: 18,
          metadata: {
            logoURI: "https://assets.relay.link/icons/1/light.png",
            verified: true,
            isNative: true,
          },
        },
        appFees: [],
        metadata: {
          sender: "0xD032A2b161c5E4a3Fa62a4789FF6B1987CB9B3Af",
          recipient: "0xD032A2b161c5E4a3Fa62a4789FF6B1987CB9B3Af",
          currencyIn: {
            currency: {
              chainId: 42161,
              address: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                logoURI: "https://assets.relay.link/icons/1/light.png",
                verified: false,
                isNative: false,
              },
            },
            amount: "126000000000000",
            amountFormatted: "0.000126",
            amountUsd: "0.296105",
          },
          currencyOut: {
            currency: {
              chainId: 59144,
              address: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                logoURI: "https://assets.relay.link/icons/1/light.png",
                verified: false,
                isNative: false,
              },
            },
            amount: "122774978113200",
            amountFormatted: "0.0001227749781132",
            amountUsd: "0.288526",
          },
          rate: "1",
        },
        price: "123420702862800",
        usesExternalLiquidity: false,
        outTxs: [
          {
            fee: "2135065660576",
            data: {
              to: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
              data: "0x033fc878",
              from: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              value: "123420702862800",
            },
            stateChanges: [
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "-123420702862800",
                },
                address: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "123420702862800",
                },
                address: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
              },
            ],
            hash: "0x40680006aed7f127f02d0c8d0c52a8fabed1d7189a277f5e4e55341a05c07fc3",
            type: "onchain",
            chainId: 59144,
            timestamp: 1726601677,
          },
        ],
      },
      createdAt: "2024-09-17T19:34:35.991Z",
      updatedAt: "2024-09-17T19:34:41.130Z",
    };

    const eventHandler = new RelayRequestProcessedEventHandler(
      requestData.id,
      requestData.status,
      requestData.user,
      requestData.recipient,
      requestData.data,
      requestData.createdAt,
      requestData.updatedAt
    );

    const activityDocumentData = await eventHandler.generateActivity();

    expect(activityDocumentData).toEqual(
      expect.objectContaining({
        chain: { id: config.chainId, name: "unknown" },
        id: "1826677ddf79813b6429bbfaaf70e4e3bfede8a63cf13efc24f8f85a157284c6",
        indexedAt: activityDocumentData?.indexedAt,
        createdAt: new Date(requestData.createdAt),
        timestamp: Math.floor(new Date(requestData.createdAt).getTime() / 1000),
        type: "bridge",
        fromAddress: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
        toAddress: "0xd032a2b161c5e4a3fa62a4789ff6b1987cb9b3af",
        amount: 0,
        contract: undefined,
        pricing: undefined,
        event: undefined,
        token: undefined,
        collection: undefined,
        order: undefined,
        data: {
          id: "0x6265f0df1abbd9695db203d9c427f22e0bc44cc00100c4adec343d4f7e4dca90",
          status: "success",
          fromCurrency: {
            txHash: "0xa98273e707aee37e4a50efe454e49dda359c0953459aedf3f1dfa35174ef6639",
            chainId: "42161",
            currency: {
              contract: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                image: "https://assets.relay.link/icons/1/light.png",
              },
            },
            amount: {
              raw: "126000000000000",
              decimal: "0.000126",
              usd: "0.296105",
            },
          },
          toCurrency: {
            txHash: "0x40680006aed7f127f02d0c8d0c52a8fabed1d7189a277f5e4e55341a05c07fc3",
            chainId: "59144",
            currency: {
              contract: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                image: "https://assets.relay.link/icons/1/light.png",
              },
            },
            amount: {
              raw: "122774978113200",
              decimal: "0.0001227749781132",
              usd: "0.288526",
            },
          },
        },
      })
    );
  });

  it("generateActivity - Handle swap request", async () => {
    const requestData = {
      id: "0xd084f3b87ea0aab295f1fa741546cc05da6dec7340ff713d72f58fde670eede9",
      status: "success",
      user: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
      recipient: "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
      data: {
        failReason: "N/A",
        fees: {
          gas: "40307261789567901",
          fixed: "0",
          price: "27636049480533699",
        },
        feesUsd: {
          gas: "7229",
          fixed: "0",
          price: "4956",
        },
        inTxs: [
          {
            fee: "10479400000000",
            data: {
              to: "0xfd06c0018318bf78705ccff2b961ef8ebc0baca0",
              data: "0x5caab55a00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000340000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef00000000000000000000000000000000000000000000000000000000000000010000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000274953d17da0600000000000000000000000000000000000000000000000000000000000000000030000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af0000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000e0b062d028236fa09fe33db8019ffeeee6bf79ed000000000000000000000000000000000000000000000000274953d17da060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000242e1a7d4d000000000000000000000000000000000000000000000000274953d17da06000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000274953d17da06000d084f3b87ea0aab295f1fa741546cc05da6dec7340ff713d72f58fde670eede9",
              from: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
              value: "0",
            },
            stateChanges: [],
            hash: "0x138409a9d5260930c0c072acddb0aedc1e9e67ece697cc68c5b300fada7c806d",
            type: "onchain",
            chainId: 660279,
            timestamp: 1726508493,
          },
        ],
        currency: "eth",
        feeCurrency: "xai",
        feeCurrencyObject: {
          chainId: 660279,
          address: "0x0000000000000000000000000000000000000000",
          symbol: "XAI",
          name: "XAI",
          decimals: 18,
          metadata: {
            logoURI: "https://assets.relay.link/icons/currencies/xai.png",
            verified: true,
            isNative: true,
          },
        },
        appFees: [],
        metadata: {
          sender: "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
          recipient: "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
          currencyIn: {
            currency: {
              chainId: 660279,
              address: "0x3fb787101dc6be47cfe18aeee15404dcc842e6af",
              symbol: "WXAI",
              name: "Wrapped XAI",
              decimals: 18,
              metadata: {
                logoURI: "https://assets.relay.link/icons/currencies/xai.png",
                verified: false,
                isNative: false,
              },
            },
            amount: "2830886000000000000",
            amountFormatted: "2.830886",
            amountUsd: "0.491467",
          },
          currencyOut: {
            currency: {
              chainId: 8453,
              address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
              symbol: "DAI",
              name: "Dai Stablecoin",
              decimals: 18,
              metadata: {
                logoURI: "https://ethereum-optimism.github.io/data/DAI/logo.svg",
                verified: false,
                isNative: false,
              },
            },
            amount: "480407409780775362",
            amountFormatted: "0.480407409780775362",
            amountUsd: "0.479797",
          },
          rate: "0.16970213911149207",
        },
        price: "210918584226964",
        usesExternalLiquidity: false,
        outTxs: [
          {
            fee: "1910516851821",
            data: {
              to: "0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab",
              data: "0x6e305f80000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002000000000000000000000000def1c0ded9bec7f1a1670819833240f027b25eff000000000000000000000000a1bea5fe917450041748dbbbe7e9ac57a4bbebab0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008800000000000000000000000000000000000000000000000000000000000000808415565b0000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb0000000000000000000000000000000000000000000000000000bfd44f4a14940000000000000000000000000000000000000000000000000699a8374676211f00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000004c000000000000000000000000000000000000000000000000000000000000005c0000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000040000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000bfd44f4a149400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000034000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000420000000000000000000000000000000000000600000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb00000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000002c00000000000000000000000000000000000000000000000000000bfd44f4a1494000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000002556e69737761705632000000000000000000000000000000000000000000000000000000000000000000bfd44f4a1494000000000000000000000000000000000000000000000000069c3204d9bb6709000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000004752ba5dbc23f44d87826276bf6fd6b1c372ad2400000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000002000000000000000000000000420000000000000000000000000000000000000600000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb000000000000000000000000000000000000000000000000000289cd934545ea000000000000000000000000ad01c20d5886137e056775af56915de824c8fce50000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000020000000000000000000000004200000000000000000000000000000000000006000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000000000869584cd00000000000000000000000094d325a6b31ae7bb78f43fb97da437c1c3f42f9600000000000000000000000000000000000000001ac090c04156f021f7bd305d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000443dad0c9c00000000000000000000000050c5725949a6f0c72e6c4a641f24049a917db0cb000000000000000000000000f0ae622e463fa757cf72243569e18be7df1996cd0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000bfd44f4a14940000000000000000000000000000000000000000000000000000000000000000033da83a",
              from: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              value: "210918584226964",
            },
            stateChanges: [
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "-210918584226964",
                },
                address: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x0000000000000000000000000000000000000000",
                  },
                  kind: "token",
                  balanceDiff: "210918584226964",
                },
                address: "0x4200000000000000000000000000000000000006",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x4200000000000000000000000000000000000006",
                  },
                  kind: "token",
                  balanceDiff: "210918584226964",
                },
                address: "0xb2839134b8151964f19f6f3c7d59c70ae52852f5",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
                  },
                  kind: "token",
                  balanceDiff: "-481121875766288350",
                },
                address: "0xb2839134b8151964f19f6f3c7d59c70ae52852f5",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
                  },
                  kind: "token",
                  balanceDiff: "714465985512938",
                },
                address: "0xad01c20d5886137e056775af56915de824c8fce5",
              },
              {
                change: {
                  data: {
                    tokenKind: "ft",
                    tokenAddress: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
                  },
                  kind: "token",
                  balanceDiff: "480407409780775412",
                },
                address: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
              },
            ],
            hash: "0x176e3c7d68e94a217d0d42449b05f83ef3c8e2128381dd47b29237d0b28b5f6b",
            type: "onchain",
            chainId: 8453,
            timestamp: 1726508507,
          },
        ],
      },
      createdAt: "2024-09-16T17:41:33.482Z",
      updatedAt: "2024-09-16T17:41:48.740Z",
    };

    const eventHandler = new RelayRequestProcessedEventHandler(
      requestData.id,
      requestData.status,
      requestData.user,
      requestData.recipient,
      requestData.data,
      requestData.createdAt,
      requestData.updatedAt
    );

    const activityDocumentData = await eventHandler.generateActivity();

    expect(activityDocumentData).toEqual(
      expect.objectContaining({
        chain: { id: config.chainId, name: "unknown" },
        id: "cd3932fee30f49b365a8d1b530727b261fd1b4ccf60c65505f247c238b3c7179",
        indexedAt: activityDocumentData?.indexedAt,
        createdAt: new Date(requestData.createdAt),
        timestamp: Math.floor(new Date(requestData.createdAt).getTime() / 1000),
        type: "swap",
        fromAddress: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
        toAddress: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
        amount: 0,
        contract: undefined,
        pricing: undefined,
        event: undefined,
        token: undefined,
        collection: undefined,
        order: undefined,
        data: {
          id: "0xd084f3b87ea0aab295f1fa741546cc05da6dec7340ff713d72f58fde670eede9",
          status: "success",
          fromCurrency: {
            txHash: "0x138409a9d5260930c0c072acddb0aedc1e9e67ece697cc68c5b300fada7c806d",
            chainId: "660279",
            currency: {
              contract: "0x3fb787101dc6be47cfe18aeee15404dcc842e6af",
              symbol: "WXAI",
              name: "Wrapped XAI",
              decimals: 18,
              metadata: {
                image: "https://assets.relay.link/icons/currencies/xai.png",
              },
            },
            amount: {
              raw: "2830886000000000000",
              decimal: "2.830886",
              usd: "0.491467",
            },
          },
          toCurrency: {
            txHash: "0x176e3c7d68e94a217d0d42449b05f83ef3c8e2128381dd47b29237d0b28b5f6b",
            chainId: "8453",
            currency: {
              contract: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
              symbol: "DAI",
              name: "Dai Stablecoin",
              decimals: 18,
              metadata: {
                image: "https://ethereum-optimism.github.io/data/DAI/logo.svg",
              },
            },
            amount: {
              raw: "480407409780775362",
              decimal: "0.480407409780775362",
              usd: "0.479797",
            },
          },
        },
      })
    );
  });

  it("generateActivity - Handle same chain swap request", async () => {
    const requestData = {
      id: "0x341ef5dc2ce205539f2d30bef5a62c8effe499ab87a313b0d4af1e63723835b9",
      status: "success",
      user: "0xfe62dec6c774eccb78bb36e1078f2da4d1f12fdf",
      recipient: "0xfe62dec6c774eccb78bb36e1078f2da4d1f12fdf",
      data: {
        failReason: "N/A",
        fees: {
          gas: "40307261789567901",
          fixed: "0",
          price: "27636049480533699",
        },
        feesUsd: {
          gas: "7229",
          fixed: "0",
          price: "4956",
        },
        inTxs: [
          {
            fee: "10479400000000",
            data: {
              to: "0xfd06c0018318bf78705ccff2b961ef8ebc0baca0",
              data: "0x5caab55a00000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000340000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef00000000000000000000000000000000000000000000000000000000000000010000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000274953d17da0600000000000000000000000000000000000000000000000000000000000000000030000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af0000000000000000000000003fb787101dc6be47cfe18aeee15404dcc842e6af000000000000000000000000f70da97812cb96acdf810712aa562db8dfa3dbef0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000e0b062d028236fa09fe33db8019ffeeee6bf79ed000000000000000000000000000000000000000000000000274953d17da060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000242e1a7d4d000000000000000000000000000000000000000000000000274953d17da06000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000274953d17da06000d084f3b87ea0aab295f1fa741546cc05da6dec7340ff713d72f58fde670eede9",
              from: "0xf0ae622e463fa757cf72243569e18be7df1996cd",
              value: "0",
            },
            stateChanges: [],
            hash: "0xd9a5f6fbee86d130764499f2c552b2e5ad1b76e39e53827a0e9a8549927be3b4",
            type: "onchain",
            chainId: 8453,
            timestamp: 1726508493,
          },
        ],
        currency: "eth",
        feeCurrency: "xai",
        feeCurrencyObject: {
          chainId: 660279,
          address: "0x0000000000000000000000000000000000000000",
          symbol: "XAI",
          name: "XAI",
          decimals: 18,
          metadata: {
            logoURI: "https://assets.relay.link/icons/currencies/xai.png",
            verified: true,
            isNative: true,
          },
        },
        appFees: [],
        metadata: {
          sender: "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
          recipient: "0xF0AE622e463fa757Cf72243569E18Be7Df1996cd",
          currencyIn: {
            currency: {
              chainId: 8453,
              address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              metadata: {
                logoURI: "https://ethereum-optimism.github.io/data/USDC/logo.png",
                verified: false,
                isNative: false,
              },
            },
            amount: "2830886000000000000",
            amountFormatted: "2.830886",
            amountUsd: "0.491467",
          },
          currencyOut: {
            currency: {
              chainId: 8453,
              address: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                logoURI: "https://assets.relay.link/icons/1/light.png",
                verified: false,
                isNative: false,
              },
            },
            amount: "480407409780775362",
            amountFormatted: "0.480407409780775362",
            amountUsd: "0.479797",
          },
          rate: "0.16970213911149207",
        },
        price: "210918584226964",
        usesExternalLiquidity: false,
        outTxs: [
          {
            chainId: 8453,
          },
        ],
      },
      createdAt: "2024-09-16T17:41:33.482Z",
      updatedAt: "2024-09-16T17:41:48.740Z",
    };

    const eventHandler = new RelayRequestProcessedEventHandler(
      requestData.id,
      requestData.status,
      requestData.user,
      requestData.recipient,
      requestData.data,
      requestData.createdAt,
      requestData.updatedAt
    );

    const activityDocumentData = await eventHandler.generateActivity();

    expect(activityDocumentData).toEqual(
      expect.objectContaining({
        chain: { id: config.chainId, name: "unknown" },
        id: "a016dd47db943533497918ffa27a3f49fe5b9b16bb358ae02b537f9696033b08",
        indexedAt: activityDocumentData?.indexedAt,
        createdAt: new Date(requestData.createdAt),
        timestamp: Math.floor(new Date(requestData.createdAt).getTime() / 1000),
        type: "swap",
        fromAddress: "0xfe62dec6c774eccb78bb36e1078f2da4d1f12fdf",
        toAddress: "0xfe62dec6c774eccb78bb36e1078f2da4d1f12fdf",
        amount: 0,
        contract: undefined,
        pricing: undefined,
        event: undefined,
        token: undefined,
        collection: undefined,
        order: undefined,
        data: {
          id: "0x341ef5dc2ce205539f2d30bef5a62c8effe499ab87a313b0d4af1e63723835b9",
          status: "success",
          fromCurrency: {
            txHash: "0xd9a5f6fbee86d130764499f2c552b2e5ad1b76e39e53827a0e9a8549927be3b4",
            chainId: "8453",
            currency: {
              contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              metadata: {
                image: "https://ethereum-optimism.github.io/data/USDC/logo.png",
              },
            },
            amount: {
              raw: "2830886000000000000",
              decimal: "2.830886",
              usd: "0.491467",
            },
          },
          toCurrency: {
            txHash: undefined,
            chainId: "8453",
            currency: {
              contract: "0x0000000000000000000000000000000000000000",
              symbol: "ETH",
              name: "Ether",
              decimals: 18,
              metadata: {
                image: "https://assets.relay.link/icons/1/light.png",
              },
            },
            amount: {
              raw: "480407409780775362",
              decimal: "0.480407409780775362",
              usd: "0.479797",
            },
          },
        },
      })
    );
  });
});
