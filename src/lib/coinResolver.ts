import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { coingecko } from './coingeckoClient.js';
import { redis } from './redis.js';

const prisma = new PrismaClient();

export async function getCoinGeckoId(symbol: string): Promise<string> {
  const lowercaseSymbol = symbol.toLowerCase();
  
  const existingCoin = await prisma.coin.findUnique({
    where: { symbol: lowercaseSymbol }
  });
  if (existingCoin) return existingCoin.coingeckoId;

  let coinsListJson = await redis.get('coins_list');
  let coinsList: { id: string; symbol: string; name: string }[] = [];

  if (!coinsListJson) {
    try {
      coinsList = await coingecko.getCoinsList();
      await redis.set('coins_list', JSON.stringify(coinsList), 'EX', 86400); // 24 hours
    } catch (err) {
      throw new GraphQLError('Failed to fetch coins list from CoinGecko', {
        extensions: { code: 'COINGECKO_API_ERROR' },
      });
    }
  } else {
    coinsList = JSON.parse(coinsListJson);
  }

  const matches = coinsList.filter(c => c.symbol.toLowerCase() === lowercaseSymbol);
  if (matches.length === 0) {
    throw new GraphQLError(`Coin with symbol ${symbol} not found`, {
      extensions: { code: 'COIN_NOT_FOUND' },
    });
  }

  const coinData = matches.find(c => c.id === lowercaseSymbol) || matches[0];
  
  await prisma.coin.create({
    data: {
      symbol: lowercaseSymbol,
      coingeckoId: coinData.id,
      name: coinData.name,
    }
  });

  return coinData.id;
}
