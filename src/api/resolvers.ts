import { PrismaClient } from '@prisma/client';
import { GraphQLError } from 'graphql';
import { coingecko } from '../lib/coingeckoClient.js';
import { syncQueue } from '../lib/queue.js';
import { Interval, generateRequiredDates, findMissingRanges } from '../lib/dateUtils.js';
import { getCoinGeckoId } from '../lib/coinResolver.js';
import { startOfDay } from 'date-fns';

const prisma = new PrismaClient();

export const resolvers = {
  Query: {
    historicalPrices: async (
      _: any,
      { coin, from, to, interval }: { coin: string; from: string; to: string; interval: Interval }
    ) => {
      const coingeckoId = await getCoinGeckoId(coin);

      let requiredDates: Date[];
      try {
        requiredDates = generateRequiredDates(from, to, interval);
      } catch (err: any) {
        throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
      }

      if (requiredDates.length === 0) return [];

      const dbCoin = await prisma.coin.findUnique({ where: { coingeckoId } });
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
          const fromUnix = Math.floor(range.from.getTime() / 1000);
          const toUnix = Math.floor(range.to.getTime() / 1000) + 86400; // +1 day to ensure inclusion

          const data = await coingecko.getCoinHistoryRange(coingeckoId, fromUnix, toUnix);
          
          const pricesMap = new Map(data.prices.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
          const capsMap = new Map(data.market_caps.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
          const volsMap = new Map(data.total_volumes.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));

          const createData = [];
          for (const [timestamp, price] of pricesMap.entries()) {
            createData.push({
              coinId: dbCoin.id,
              date: new Date(timestamp),
              priceUsd: price,
              marketCap: capsMap.get(timestamp) || null,
              volume: volsMap.get(timestamp) || null,
              granularity: 'daily',
              source: 'coingecko'
            });
          }

          if (createData.length > 0) {
            await prisma.$transaction(
              createData.map(data => 
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
          console.error(`Error fetching missing range for ${coingeckoId}:`, err.message);
        }
      }

      syncQueue.add('sync-max-range', {
        coinId: dbCoin.id,
        coingeckoId: dbCoin.coingeckoId,
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
