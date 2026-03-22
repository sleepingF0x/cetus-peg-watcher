import fs from 'fs';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { ResolvedTradeConfig } from '../config.js';

export interface TraderContext {
  keypair: Ed25519Keypair;
  walletAddress: string;
  suiClient: SuiClient;
  aggregator: AggregatorClient;
}

const contextCache = new Map<string, TraderContext>();

export function getTraderContext(tradeConfig: ResolvedTradeConfig): TraderContext {
  const cacheKey = `${tradeConfig.mnemonicFile}|${tradeConfig.derivationPath}|${tradeConfig.rpcUrl}`;
  const cached = contextCache.get(cacheKey);
  if (cached) return cached;

  const mnemonic = fs.readFileSync(tradeConfig.mnemonicFile, 'utf-8').trim();
  if (!mnemonic) {
    throw new Error(`mnemonic file is empty: ${tradeConfig.mnemonicFile}`);
  }

  const keypair = Ed25519Keypair.deriveKeypair(mnemonic, tradeConfig.derivationPath);
  const walletAddress = keypair.getPublicKey().toSuiAddress();
  const suiClient = new SuiClient({ url: tradeConfig.rpcUrl });
  const aggregator = new AggregatorClient({ client: suiClient, signer: walletAddress });

  const context: TraderContext = { keypair, walletAddress, suiClient, aggregator };
  contextCache.set(cacheKey, context);
  return context;
}
