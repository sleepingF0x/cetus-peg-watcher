export function getTokenSymbol(coinType: string): string {
  const parts = coinType.split('::');
  if (parts.length >= 3) {
    return parts[parts.length - 1];
  }
  return parts[parts.length - 1] || coinType;
}

export function formatPair(baseToken: string, quoteToken: string): string {
  return `${getTokenSymbol(baseToken)}/${getTokenSymbol(quoteToken)}`;
}

export function formatAmount(
  amount: string | bigint | undefined,
  decimals: number,
  maxDecimals: number = 6,
): string {
  if (amount === undefined || amount === null) {
    return '-';
  }

  try {
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
    if (amountBigInt === 0n) {
      return '0';
    }

    const amountStr = amountBigInt.toString();
    const decimalsNum = Math.max(0, decimals);

    if (decimalsNum === 0) {
      return amountStr;
    }

    const paddedAmount = amountStr.padStart(decimalsNum + 1, '0');
    const integerPart = paddedAmount.slice(0, -decimalsNum) || '0';
    const fractionalPart = paddedAmount.slice(-decimalsNum);

    const trimmedFractional = fractionalPart
      .replace(/0+$/, '')
      .slice(0, maxDecimals);

    if (trimmedFractional.length === 0) {
      return integerPart;
    }

    return `${integerPart}.${trimmedFractional}`;
  } catch {
    return String(amount);
  }
}

export function calculateExecutedPrice(
  amountIn: string | bigint | undefined,
  amountOut: string | bigint | undefined,
  baseDecimals: number,
  quoteDecimals: number,
): number | null {
  if (amountIn === undefined || amountOut === undefined) {
    return null;
  }

  try {
    const inBigInt = typeof amountIn === 'string' ? BigInt(amountIn) : amountIn;
    const outBigInt = typeof amountOut === 'string' ? BigInt(amountOut) : amountOut;

    if (inBigInt === 0n) {
      return null;
    }

    const rawRatio = Number(outBigInt) / Number(inBigInt);
    const decimalAdjustment = Math.pow(10, baseDecimals - quoteDecimals);

    return rawRatio * decimalAdjustment;
  } catch {
    return null;
  }
}

export function formatPrice(price: number | null, maxDecimals: number = 6): string {
  if (price === null || price === undefined) {
    return '-';
  }

  if (price >= 1000) {
    return price.toFixed(2);
  } else if (price >= 1) {
    return price.toFixed(maxDecimals);
  } else if (price >= 0.01) {
    return price.toFixed(Math.min(maxDecimals + 2, 8));
  } else {
    return price.toFixed(Math.min(maxDecimals + 4, 10));
  }
}
