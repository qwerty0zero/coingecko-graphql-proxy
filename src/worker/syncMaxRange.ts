import { PrismaClient } from '@prisma/client';
import { binance } from '../lib/binanceClient.js';
import { startOfDay, subDays, isBefore } from 'date-fns';
import { Job } from 'bullmq';

const prisma = new PrismaClient();

export async function processSyncMaxRange(job: Job) {
  const { coinId, coingeckoId } = job.data;
  
  const coin = await prisma.coin.findUnique({ where: { id: coinId } });
  if (!coin) return;

  // Binance allows syncing all the way back. Let's set an arbitrary genesis date if none is known (e.g., 2017-08-01 for Binance's launch).
  // If the coin was listed later, Binance will just return empty for the early dates and we'll process what we get.
  let genesisDate = coin.genesisDate;
  if (!genesisDate) {
    genesisDate = new Date('2017-08-01');
    await prisma.coin.update({
      where: { id: coinId },
      data: { genesisDate }
    });
  }

  // Define target range
  const targetEnd = startOfDay(subDays(new Date(), 1)); // Yesterday
  const targetStart = startOfDay(genesisDate);

  let currentStart = coin.lastSyncedFrom || targetEnd;
  let currentEnd = coin.lastSyncedTo || targetEnd;

  // Backfill old data (chunked by 1000 days since Binance allows 1000 limit)
  while (isBefore(targetStart, currentStart)) {
    // 1000 days is approx 2.7 years
    const chunkStart = startOfDay(new Date(Math.max(targetStart.getTime(), currentStart.getTime() - (1000 * 24 * 60 * 60 * 1000))));
    
    const fromUnixMs = chunkStart.getTime();
    const toUnixMs = currentStart.getTime();

    console.log(`Worker: Syncing backwards ${coingeckoId} from ${chunkStart.toISOString()} to ${currentStart.toISOString()}`);
    
    try {
      const klines = await binance.getKlines(coingeckoId, fromUnixMs, toUnixMs);

      if (klines.length > 0) {
        const createData = klines.map((k: any) => ({
          coinId: coin.id,
          date: new Date(k.timestamp),
          priceUsd: k.close,
          marketCap: null,
          volume: k.volume,
          granularity: 'daily',
          source: 'binance'
        }));

        await prisma.priceHistory.createMany({
          data: createData,
          skipDuplicates: true,
        });
      }

      currentStart = chunkStart;
      await prisma.coin.update({
        where: { id: coin.id },
        data: { lastSyncedFrom: currentStart }
      });
      
      // If we got fewer than expected, we might have hit the coin's actual listing date! 
      // But to be safe, we just keep going back until targetStart.
    } catch (err: any) {
      console.error(`Worker failed to sync backwards chunk for ${coingeckoId}:`, err.message);
      break; 
    }
  }

  // Update new data (from lastSyncedTo to targetEnd)
  if (isBefore(currentEnd, targetEnd)) {
    const fromUnixMs = currentEnd.getTime();
    const toUnixMs = targetEnd.getTime() + (24 * 60 * 60 * 1000); // add 1 day

    console.log(`Worker: Syncing forward ${coingeckoId} from ${currentEnd.toISOString()} to ${targetEnd.toISOString()}`);

    try {
      const klines = await binance.getKlines(coingeckoId, fromUnixMs, toUnixMs);

      if (klines.length > 0) {
        const createData = klines.map((k: any) => ({
          coinId: coin.id,
          date: new Date(k.timestamp),
          priceUsd: k.close,
          marketCap: null,
          volume: k.volume,
          granularity: 'daily',
          source: 'binance'
        }));

        await prisma.priceHistory.createMany({
          data: createData,
          skipDuplicates: true,
        });
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
