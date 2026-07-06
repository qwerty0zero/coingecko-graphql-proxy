import { PrismaClient } from '@prisma/client';
import { coingecko } from '../lib/coingeckoClient.js';
import { startOfDay, subDays, isBefore } from 'date-fns';
import { Job } from 'bullmq';

const prisma = new PrismaClient();

export async function processSyncMaxRange(job: Job) {
  const { coinId, coingeckoId } = job.data;
  
  const coin = await prisma.coin.findUnique({ where: { id: coinId } });
  if (!coin) return;

  // 1. Get genesis date
  let genesisDate = coin.genesisDate;
  if (!genesisDate) {
    genesisDate = await coingecko.getCoinGenesis(coingeckoId);
    if (!genesisDate) {
      genesisDate = new Date('2013-01-01');
    }
    await prisma.coin.update({
      where: { id: coinId },
      data: { genesisDate }
    });
  }

  // 2. Define target range
  const targetEnd = startOfDay(subDays(new Date(), 1)); // Yesterday
  const targetStart = startOfDay(genesisDate);

  let currentStart = coin.lastSyncedFrom || targetEnd;
  let currentEnd = coin.lastSyncedTo || targetEnd;

  // 3. Backfill old data (chunked by 2 years)
  while (isBefore(targetStart, currentStart)) {
    const chunkStart = startOfDay(new Date(Math.max(targetStart.getTime(), currentStart.getTime() - (2 * 365 * 24 * 60 * 60 * 1000))));
    
    const fromUnix = Math.floor(chunkStart.getTime() / 1000);
    const toUnix = Math.floor(currentStart.getTime() / 1000) + 86400;

    console.log(`Worker: Syncing backwards ${coingeckoId} from ${chunkStart.toISOString()} to ${currentStart.toISOString()}`);
    
    try {
      const data = await coingecko.getCoinHistoryRange(coingeckoId, fromUnix, toUnix);
      
      const pricesMap = new Map(data.prices.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
      const capsMap = new Map(data.market_caps.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
      const volsMap = new Map(data.total_volumes.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));

      const createData = [];
      for (const [timestamp, price] of pricesMap.entries()) {
        createData.push({
          coinId: coin.id,
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

      currentStart = chunkStart;
      await prisma.coin.update({
        where: { id: coin.id },
        data: { lastSyncedFrom: currentStart }
      });
    } catch (err: any) {
      console.error(`Worker failed to sync backwards chunk for ${coingeckoId}:`, err.message);
      break; 
    }
  }

  // 4. Update new data (from lastSyncedTo to targetEnd)
  if (isBefore(currentEnd, targetEnd)) {
    const fromUnix = Math.floor(currentEnd.getTime() / 1000);
    const toUnix = Math.floor(targetEnd.getTime() / 1000) + 86400;

    console.log(`Worker: Syncing forward ${coingeckoId} from ${currentEnd.toISOString()} to ${targetEnd.toISOString()}`);

    try {
      const data = await coingecko.getCoinHistoryRange(coingeckoId, fromUnix, toUnix);
      const pricesMap = new Map(data.prices.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
      const capsMap = new Map(data.market_caps.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));
      const volsMap = new Map(data.total_volumes.map((p: any) => [startOfDay(new Date(p[0])).getTime(), p[1]]));

      const createData = [];
      for (const [timestamp, price] of pricesMap.entries()) {
        createData.push({
          coinId: coin.id,
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

      currentEnd = targetEnd;
      await prisma.coin.update({
        where: { id: coin.id },
        data: { lastSyncedTo: currentEnd }
      });
    } catch (err: any) {
      console.error(`Worker failed to sync forward chunk for ${coingeckoId}:`, err.message);
    }
  }
}
