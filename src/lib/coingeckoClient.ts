import Bottleneck from 'bottleneck';

export class CoinGeckoService {
  private limiter: Bottleneck;
  private baseUrl = 'https://api.coingecko.com/api/v3';

  constructor() {
    this.limiter = new Bottleneck({
      minTime: 2500,
    });

    this.limiter.on('failed', async (error, jobInfo) => {
      const id = jobInfo.options.id;
      console.warn(`Job ${id} failed: ${error}`);
      if (jobInfo.retryCount < 3) {
        const delay = Math.pow(2, jobInfo.retryCount) * 5000;
        console.log(`Retrying job ${id} after ${delay}ms...`);
        return delay;
      }
    });
  }

  private async fetchApi(path: string, searchParams: Record<string, string | number> = {}): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.append(key, String(value));
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (process.env.COINGECKO_API_KEY) {
      headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    }

    const res = await fetch(url.toString(), { headers });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CoinGecko API Error: ${res.status} - ${text}`);
    }

    return res.json();
  }

  async getCoinsList(): Promise<{ id: string; symbol: string; name: string }[]> {
    return this.limiter.schedule({ id: 'getCoinsList' }, () => this.fetchApi('/coins/list'));
  }

  async getCoinHistoryRange(
    id: string,
    fromUnix: number,
    toUnix: number
  ): Promise<{ prices: [number, number][]; market_caps: [number, number][]; total_volumes: [number, number][] }> {
    return this.limiter.schedule({ id: `history-${id}-${fromUnix}-${toUnix}` }, () => 
      this.fetchApi(`/coins/${id}/market_chart/range`, {
        vs_currency: 'usd',
        from: fromUnix,
        to: toUnix,
        interval: 'daily',
      })
    );
  }

  async getCoinGenesis(id: string): Promise<Date | null> {
    try {
      const data = await this.limiter.schedule({ id: `genesis-${id}` }, () => 
        this.fetchApi(`/coins/${id}`, {
          localization: 'false',
          tickers: 'false',
          market_data: 'false',
          community_data: 'false',
          developer_data: 'false',
          sparkline: 'false',
        })
      );
      if (data.genesis_date) {
        return new Date(data.genesis_date);
      }
      return null;
    } catch (err) {
      console.error(`Failed to get genesis date for ${id}:`, err);
      return null;
    }
  }
}

export const coingecko = new CoinGeckoService();
