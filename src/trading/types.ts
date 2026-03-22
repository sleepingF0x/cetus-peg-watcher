export type TradeSide = 'buy' | 'sell';
export type TradeStatus = 'skipped' | 'submitted' | 'success' | 'failure' | 'unknown';

export interface TradeExecutionResult {
  status: TradeStatus;
  side: TradeSide;
  inputCoin: string;
  outputCoin: string;
  amountIn?: string;
  amountOut?: string;
  realizedPrice?: number;
  digest?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  error?: string;
}
