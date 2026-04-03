import https from 'https';
import axios from 'axios';
import { scaleHumanAmountToAtomicAmount } from '../formatters.js';
import { createModuleLogger, toLogError } from '../logger.js';

const CETUS_API_URL = 'https://api-sui.cetus.zone/router_v3/find_routes';
const SDK_VERSION = 1010404;
const PRICE_CACHE_TTL_MS = 1000;
const DEFAULT_QUERY_AMOUNT_KEY = 'AUTO_1_BASE_TOKEN';
const DEFAULT_SUI_RPC_URL = 'https://fullnode.mainnet.sui.io:443';

const log = createModuleLogger('PriceOracle');

export interface CetusQuoteResponse {
  code: number;
  msg: string;
  data?: {
    amount_in: string;
    amount_out: string;
    paths: unknown[];
  };
}

export interface PriceQueryOptions {
  forceRefresh?: boolean;
  amountMode?: 'raw' | 'human';
}

export interface BidirectionalPrice {
  sellPrice: number;    // base → quote: quote per base (e.g. USDC per USDY)
  buyPrice: number;     // quote → base, inverted: quote per base (same units as sellPrice)
  midPrice: number;
  spreadPercent: number;
}

interface PriceQuote {
  price: number;
  amountIn: string;
  amountOut: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PriceOracle {
  private readonly priceCache = new Map<string, { value: PriceQuote | null; expiresAt: number }>();
  private readonly inFlightRequests = new Map<string, Promise<PriceQuote | null>>();
  private readonly decimalsCache = new Map<string, number>();
  private readonly httpsAgent: https.Agent;

  constructor(private readonly rpcUrl: string = DEFAULT_SUI_RPC_URL) {
    this.httpsAgent = new https.Agent({ keepAlive: true });
  }

  async getCoinDecimals(coinType: string): Promise<number | null> {
    const cached = this.decimalsCache.get(coinType);
    if (cached !== undefined) return cached;

    try {
      const response = await axios.post<{ result?: { decimals?: number } }>(this.rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getCoinMetadata',
        params: [coinType],
      }, { timeout: 15000, httpsAgent: this.httpsAgent });

      const decimals = response.data.result?.decimals;
      if (typeof decimals === 'number') {
        this.decimalsCache.set(coinType, decimals);
        return decimals;
      }
    } catch {
      return null;
    }

    return null;
  }

  async getPrice(
    baseToken: string,
    quoteToken: string,
    amount?: string | number | bigint,
    options?: PriceQueryOptions,
  ): Promise<number | null> {
    const quote = await this.getQuote(baseToken, quoteToken, amount, options);
    return quote?.price ?? null;
  }

  async getBidirectionalPrice(
    baseToken: string,
    quoteToken: string,
    amount?: string | number | bigint,
    options?: PriceQueryOptions,
  ): Promise<BidirectionalPrice | null> {
    const sellQuote = await this.getQuote(baseToken, quoteToken, amount, options);
    if (sellQuote === null) {
      return null;
    }

    const rawBuyQuote = await this.getQuote(quoteToken, baseToken, sellQuote.amountOut, {
      amountMode: 'raw',
      forceRefresh: options?.forceRefresh,
    });

    if (rawBuyQuote === null || rawBuyQuote.price === 0) {
      return null;
    }

    const sellPrice = sellQuote.price;
    // rawBuyQuote.price is returned as baseToken-per-quoteToken from the quote→base query.
    // Invert it so both sides are expressed as quoteToken-per-baseToken.
    const buyPrice = 1 / rawBuyQuote.price;
    const midPrice = (sellPrice + buyPrice) / 2;
    const spreadPercent = midPrice > 0
      ? ((buyPrice - sellPrice) / midPrice) * 100
      : 0;

    return { sellPrice, buyPrice, midPrice, spreadPercent };
  }

  private async getQuote(
    baseToken: string,
    quoteToken: string,
    amount?: string | number | bigint,
    options?: PriceQueryOptions,
  ): Promise<PriceQuote | null> {
    const forceRefresh = options?.forceRefresh === true;
    const amountMode = options?.amountMode ?? 'raw';
    const normalizedAmountKey = amount !== undefined && amount !== null
      ? `${amountMode}:${String(amount)}`
      : DEFAULT_QUERY_AMOUNT_KEY;
    const cacheKey = `${baseToken}::${quoteToken}::${normalizedAmountKey}`;

    if (!forceRefresh) {
      const cached = this.priceCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const inFlight = this.inFlightRequests.get(cacheKey);
      if (inFlight) return inFlight;
    }

    const requestPromise = this.fetchQuote(baseToken, quoteToken, amount, amountMode, cacheKey);

    // forceRefresh: skip in-flight map entirely — run independently, no coalescing
    if (forceRefresh) {
      const result = await requestPromise;
      this.priceCache.set(cacheKey, { value: result, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
      return result;
    }

    this.inFlightRequests.set(cacheKey, requestPromise);
    try {
      const result = await requestPromise;
      this.priceCache.set(cacheKey, { value: result, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
      return result;
    } finally {
      this.inFlightRequests.delete(cacheKey);
    }
  }

  private async fetchQuote(
    baseToken: string,
    quoteToken: string,
    amount: string | number | bigint | undefined,
    amountMode: 'raw' | 'human',
    cacheKey: string,
  ): Promise<PriceQuote | null> {
    const retries = 3;
    const backoffDelays = [1000, 2000, 4000];

    for (let i = 0; i <= retries; i++) {
      try {
        const [baseDecimals, quoteDecimals] = await Promise.all([
          this.getCoinDecimals(baseToken),
          this.getCoinDecimals(quoteToken),
        ]);

        if (baseDecimals === null || quoteDecimals === null) {
          log.error(
            { event: 'price_fetch_decimals_failed', baseToken, quoteToken, attempt: i + 1, retries },
            'Failed to fetch decimals, skipping price calculation',
          );
          if (i === retries) return null;
          await delay(backoffDelays[i]);
          continue;
        }

        const queryAmount = amount === undefined || amount === null
          ? Math.pow(10, baseDecimals).toString()
          : amountMode === 'human'
            ? scaleHumanAmountToAtomicAmount(String(amount), baseDecimals).toString()
            : String(amount);

        const response = await axios.get<CetusQuoteResponse>(CETUS_API_URL, {
          params: {
            from: baseToken,
            target: quoteToken,
            amount: queryAmount,
            by_amount_in: true,
            v: SDK_VERSION,
          },
          timeout: 10000,
          httpsAgent: this.httpsAgent,
        });

        if (response.data.code === 200 && response.data.data?.paths && response.data.data.paths.length > 0) {
          const amountIn = queryAmount;
          const amountOut = response.data.data.amount_out;
          const rawPrice = Number(BigInt(amountOut)) / Number(BigInt(amountIn));
          const computedPrice = rawPrice * Math.pow(10, baseDecimals - quoteDecimals);
          return {
            price: computedPrice,
            amountIn,
            amountOut,
          };
        } else {
          log.error(
            {
              event: 'price_fetch_api_error',
              baseToken,
              quoteToken,
              attempt: i + 1,
              retries,
              code: response.data.code,
              apiMessage: response.data.msg || 'Unknown error',
            },
            'Cetus API returned an unsuccessful response',
          );
          if (i === retries) return null;
        }
      } catch (error: unknown) {
        if (i === retries) {
          log.error(
            { event: 'price_fetch_failed', cacheKey, retries, err: toLogError(error) },
            `Failed to fetch price from Cetus after ${retries} retries`,
          );
          return null;
        }
        await delay(backoffDelays[i]);
      }
    }

    return null;
  }
}
