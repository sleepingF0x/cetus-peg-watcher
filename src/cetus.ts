import axios from 'axios';
import { getCoinDecimals } from './coin-metadata.js';
import { scaleHumanAmountToAtomicAmount } from './formatters.js';
import { createModuleLogger, toLogError } from './logger.js';

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
const PRICE_CACHE_TTL_MS = 1000;
const DEFAULT_QUERY_AMOUNT_KEY = 'AUTO_1_BASE_TOKEN';
const log = createModuleLogger('Cetus');

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const priceCache = new Map<string, { value: number | null; expiresAt: number }>();
const inFlightPriceRequests = new Map<string, Promise<number | null>>();

export async function getTokenPrice(
  baseToken: string,
  quoteToken: string,
  amount?: string | number | bigint,
  options?: {
    forceRefresh?: boolean;
    amountMode?: 'raw' | 'human';
  }
): Promise<number | null> {
  const forceRefresh = options?.forceRefresh === true;
  const amountMode = options?.amountMode || 'raw';
  const normalizedAmountKey = amount !== undefined && amount !== null
    ? `${amountMode}:${String(amount)}`
    : DEFAULT_QUERY_AMOUNT_KEY;
  const cacheKey = `${baseToken}::${quoteToken}::${normalizedAmountKey}`;
  const now = Date.now();
  if (!forceRefresh) {
    const cachedPrice = priceCache.get(cacheKey);
    if (cachedPrice && cachedPrice.expiresAt > now) {
      return cachedPrice.value;
    }

    const inFlight = inFlightPriceRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const requestPromise = (async (): Promise<number | null> => {
  const retries = 3;
  const backoffDelays = [1000, 2000, 4000];

  for (let i = 0; i <= retries; i++) {
    try {
      const [baseDecimals, quoteDecimals] = await Promise.all([
        getCoinDecimals(baseToken),
        getCoinDecimals(quoteToken),
      ]);

      if (baseDecimals === null || quoteDecimals === null) {
        log.error(
          {
            event: 'price_fetch_decimals_failed',
            baseToken,
            quoteToken,
            attempt: i + 1,
            retries,
          },
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
      });

      if (response.data.code === 200 && response.data.data && response.data.data.paths && response.data.data.paths.length > 0) {
        const amountOut = BigInt(response.data.data.amount_out);
        const amountIn = BigInt(queryAmount);

        const rawPrice = Number(amountOut) / Number(amountIn);
        const decimalAdjustment = Math.pow(10, baseDecimals - quoteDecimals);
        const computedPrice = rawPrice * decimalAdjustment;
        priceCache.set(cacheKey, {
          value: computedPrice,
          expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
        });
        return computedPrice;
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
          {
            event: 'price_fetch_failed',
            baseToken,
            quoteToken,
            retries,
            err: toLogError(error),
          },
          `Failed to fetch price from Cetus after ${retries} retries`,
        );
        return null;
      }
      await delay(backoffDelays[i]);
    }
  }

  return null;
  })();

  inFlightPriceRequests.set(cacheKey, requestPromise);

  try {
    const result = await requestPromise;
    if (result === null) {
      priceCache.set(cacheKey, {
        value: null,
        expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
      });
    }
    return result;
  } finally {
    inFlightPriceRequests.delete(cacheKey);
  }
}
