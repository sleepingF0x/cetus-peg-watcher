// Shim wrapping the singleton PriceOracle — keeps the public API stable for engine/runner.ts
import { PriceOracle } from './pricing/oracle.js';
export type { CetusQuoteResponse, BidirectionalPrice } from './pricing/oracle.js';

const defaultOracle = new PriceOracle();

export async function getTokenPrice(
  baseToken: string,
  quoteToken: string,
  amount?: string | number | bigint,
  options?: { forceRefresh?: boolean; amountMode?: 'raw' | 'human' },
): Promise<number | null> {
  return defaultOracle.getPrice(baseToken, quoteToken, amount, options);
}

export async function getBidirectionalPrice(
  baseToken: string,
  quoteToken: string,
  amount?: string | number | bigint,
  options?: { forceRefresh?: boolean; amountMode?: 'raw' | 'human' },
): Promise<import('./pricing/oracle.js').BidirectionalPrice | null> {
  return defaultOracle.getBidirectionalPrice(baseToken, quoteToken, amount, options);
}
