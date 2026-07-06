import Bottleneck from 'bottleneck';

export class BinanceService {
  private limiter: Bottleneck;
  private baseUrl = 'https://api.binance.com/api/v3';

  constructor() {
    // Binance Spot API allows 6000 weight per minute. Klines is weight 2.
    // We can safely do 10 requests per second. Let's be conservative and do 5/sec.
    this.limiter = new Bottleneck({
      minTime: 200,
    });

    this.limiter.on('failed', async (error: Error, jobInfo) => {
      const id = jobInfo.options.id;
      console.warn(`Binance Job ${id} failed: ${error}`);
      if (jobInfo.retryCount < 3) {
        return  Math.pow(2, jobInfo.retryCount) * 1000;
      }
    });
  }

  private async fetchApi(path: string, searchParams: Record<string, string | number> = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.append(key, String(value));
    }

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Binance API Error: ${res.status} - ${text}`);
    }

    return res.json();
  }

  async getExchangeInfo(): Promise<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }[]> {
    const data = await this.limiter.schedule({ id: 'exchangeInfo' }, () => this.fetchApi('/exchangeInfo'));
    return data.symbols.map((s: any) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      status: s.status
    }));
  }

  async getKlines(
    symbol: string,
    startTime: number,
    endTime: number
  ): Promise<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]> {
    const data = await this.limiter.schedule({ id: `klines-${symbol}-${startTime}-${endTime}` }, () => 
      this.fetchApi('/klines', {
        symbol,
        interval: '1d',
        startTime,
        endTime,
        limit: 1000
      })
    );

    return data.map((k: any) => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]), // We use 'close' as the daily price
      volume: parseFloat(k[5]),
    }));
  }
}

export const binance = new BinanceService();
