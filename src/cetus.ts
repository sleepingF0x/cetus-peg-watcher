import axios from 'axios';

export interface CetusQuoteResponse {
  code: number;
  msg: string;
  data?: {
    amount_in: string;
    amount_out: string;
    paths: unknown[];
  };
}

const CETUS_API_URL = 'https://api-sui.cetus.zone/router_v3/find_routes';
const SDK_VERSION = 1010404;

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443';

const decimalsCache = new Map<string, number>();

async function getDecimals(coinType: string): Promise<number | null> {
  const cached = decimalsCache.get(coinType);
  if (cached !== undefined) return cached;

  try {
    const response = await axios.post(SUI_RPC_URL, {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getCoinMetadata',
      params: [coinType],
    }, {
      timeout: 15000,
    });

    if (response.data?.result?.decimals !== undefined) {
      decimalsCache.set(coinType, response.data.result.decimals);
      return response.data.result.decimals;
    }
  } catch (error: any) {
    console.error(`Error fetching metadata for ${coinType}: ${error.message}`);
  }
  return null;
}

export async function getTokenPrice(
  baseToken: string,
  quoteToken: string,
  amount?: string
): Promise<number | null> {
  const retries = 3;
  const backoffDelays = [1000, 2000, 4000];

  for (let i = 0; i <= retries; i++) {
    try {
      const [baseDecimals, quoteDecimals] = await Promise.all([
        getDecimals(baseToken),
        getDecimals(quoteToken),
      ]);

      if (baseDecimals === null || quoteDecimals === null) {
        console.error(`[Cetus] Failed to fetch decimals, skipping price calculation`);
        if (i === retries) return null;
        await delay(backoffDelays[i]);
        continue;
      }

      const queryAmount = amount || Math.pow(10, baseDecimals).toString();

      const response = await axios.get<CetusQuoteResponse>(CETUS_API_URL, {
        params: {
          from: baseToken,
          target: quoteToken,
          amount: queryAmount,
          by_amount_in: true,
          v: SDK_VERSION,
        },
        timeout: 10000,
      });

      if (response.data.code === 200 && response.data.data && response.data.data.paths && response.data.data.paths.length > 0) {
        const amountOut = BigInt(response.data.data.amount_out);
        const amountIn = BigInt(queryAmount);
        
        const rawPrice = Number(amountOut) / Number(amountIn);
        const decimalAdjustment = Math.pow(10, baseDecimals - quoteDecimals);
        return rawPrice * decimalAdjustment;
      } else {
        console.error(`Cetus API error: ${response.data.msg || 'Unknown error'}`);
        if (i === retries) return null;
      }
    } catch (error: any) {
      if (i === retries) {
        console.error(`Failed to fetch price from Cetus after ${retries} retries: ${error.message}`);
        return null;
      }
      await delay(backoffDelays[i]);
    }
  }

  return null;
}
