import axios from 'axios';

const DEFAULT_SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const decimalsCache = new Map<string, number>();

interface RpcResponse<T> {
  result?: T;
}

export async function getCoinDecimals(
  coinType: string,
  rpcUrl: string = DEFAULT_SUI_RPC_URL,
): Promise<number | null> {
  const cacheKey = `${rpcUrl}::${coinType}`;
  const cached = decimalsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const response = await axios.post<RpcResponse<{ decimals?: number }>>(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getCoinMetadata',
      params: [coinType],
    }, {
      timeout: 15000,
    });

    const decimals = response.data.result?.decimals;
    if (typeof decimals === 'number') {
      decimalsCache.set(cacheKey, decimals);
      return decimals;
    }
  } catch {
    return null;
  }

  return null;
}
