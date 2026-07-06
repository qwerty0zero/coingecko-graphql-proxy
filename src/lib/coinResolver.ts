import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { binance } from './binanceClient.js';
import { redis } from './redis.js';

const prisma = new PrismaClient();

const COMMON_NAMES: Record<string, string> = {
  'bitcoin': 'btc',
  'ethereum': 'eth',
  'solana': 'sol',
  'cardano': 'ada',
  'ripple': 'xrp',
  'dogecoin': 'doge',
  'polkadot': 'dot',
  'chainlink': 'link',
  'litecoin': 'ltc',
  'binancecoin': 'bnb',
  'matic-network': 'matic',
  'avalanche-2': 'avax',
};

export async function getCoinGeckoId(symbol: string): Promise<string> {
  let lookupName = symbol.toLowerCase();
  if (COMMON_NAMES[lookupName]) {
    lookupName = COMMON_NAMES[lookupName];
  }

  const existingCoin = await prisma.coin.findUnique({
    where: { symbol: lookupName }
  });
  if (existingCoin) return existingCoin.coingeckoId;

  let symbolsListJson = await redis.get('binance_symbols');
  let symbolsList: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] = [];

  if (!symbolsListJson) {
    try {
      symbolsList = await binance.getExchangeInfo();
      await redis.set('binance_symbols', JSON.stringify(symbolsList), 'EX', 86400); // 24 hours
    } catch (err) {
      throw new GraphQLError('Failed to fetch symbols list from Binance', {
        extensions: { code: 'BINANCE_API_ERROR' },
      });
    }
  } else {
    symbolsList = JSON.parse(symbolsListJson);
  }

  const usdtPairs = symbolsList.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
  
  const matches = usdtPairs.filter(s => s.baseAsset.toLowerCase() === lookupName);
  if (matches.length === 0) {
    throw new GraphQLError(`Coin with symbol ${symbol} not found on Binance (USDT pairs only)`, {
      extensions: { code: 'COIN_NOT_FOUND' },
    });
  }

  const binanceSymbol = matches[0].symbol;
  
  await prisma.coin.create({
    data: {
      symbol: lookupName,
      coingeckoId: binanceSymbol, // We reuse the coingeckoId column to store the Binance Symbol (e.g. BTCUSDT)
      name: matches[0].baseAsset,
    }
  });

  return binanceSymbol;
}
