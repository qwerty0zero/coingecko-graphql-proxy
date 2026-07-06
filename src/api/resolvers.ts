import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { binance } from '../lib/binanceClient.js';
import { syncQueue } from '../lib/queue.js';
import { Interval, generateRequiredDates, findMissingRanges } from '../lib/dateUtils.js';
import { getCoinGeckoId } from '../lib/coinResolver.js';

const prisma = new PrismaClient();

export const resolvers = {
  Query: {
    historicalPrices: async (
      _: any,
      { coin, from, to, interval }: { coin: string; from: string; to: string; interval: Interval }
    ) => {
      // getCoinGeckoId now returns Binance symbol (e.g. BTCUSDT)
      const binanceSymbol = await getCoinGeckoId(coin);

      let requiredDates: Date[];
      try {
        requiredDates = generateRequiredDates(from, to, interval);
      } catch (err: any) {
        throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
      }

      if (requiredDates.length === 0) return [];

      const dbCoin = await prisma.coin.findUnique({ where: { coingeckoId: binanceSymbol } });
      if (!dbCoin) throw new Error('Coin not found in DB after resolution');

      const existingPrices = await prisma.priceHistory.findMany({
        where: {
          coinId: dbCoin.id,
          date: {
            in: requiredDates
          },
          granularity: 'daily'
        }
      });

      const existingDates = existingPrices.map(p => p.date);
      const missingRanges = findMissingRanges(requiredDates, existingDates);

      for (const range of missingRanges) {
        try {
          const fromUnixMs = range.from.getTime();
          const toUnixMs = range.to.getTime() + (24 * 60 * 60 * 1000); // add 1 day margin

          const klines = await binance.getKlines(binanceSymbol, fromUnixMs, toUnixMs);
          
          if (klines.length > 0) {
            const createData = klines.map((k: any) => ({
              coinId: dbCoin.id,
              date: new Date(k.timestamp),
              priceUsd: k.close,
              marketCap: null,
              volume: k.volume,
              granularity: 'daily',
              source: 'binance'
            }));

            await prisma.$transaction(
              createData.map((data: any) => 
                prisma.priceHistory.upsert({
                  where: {
                    coinId_date_granularity: {
                      coinId: data.coinId,
                      date: data.date,
                      granularity: 'daily'
                    }
                  },
                  update: {
                    priceUsd: data.priceUsd,
                    marketCap: data.marketCap,
                    volume: data.volume,
                  },
                  create: data
                })
              )
            );
          }
        } catch (err: any) {
          console.error(`Error fetching missing range for ${binanceSymbol}:`, err.message);
        }
      }

      syncQueue.add('sync-max-range', {
        coinId: dbCoin.id,
        coingeckoId: dbCoin.coingeckoId, // This is Binance Symbol
        symbol: dbCoin.symbol,
      }).catch(err => console.error('Failed to enqueue sync job', err));

      const finalPrices = await prisma.priceHistory.findMany({
        where: {
          coinId: dbCoin.id,
          date: {
            in: requiredDates
          },
          granularity: 'daily'
        }
      });

      const resultMap = new Map(finalPrices.map(p => [p.date.getTime(), p]));

      return requiredDates.map(date => {
        const p = resultMap.get(date.getTime());
        if (!p) return null;
        
        return {
          date: date.toISOString().split('T')[0],
          priceUsd: Number(p.priceUsd),
          marketCap: p.marketCap ? Number(p.marketCap) : null,
          volume: p.volume ? Number(p.volume) : null,
        };
      }).filter(Boolean);
    }
  }
};
