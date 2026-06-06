interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
}

interface AssetRow {
  shares: number;
  market_price: number;
  symbol: string;
  Role: string;
  name?: string;
}

interface ChartStat {
  label: string;
  value: number;
}

interface QdiiRow {
  name: string;
  quota: number;
  updated_at: string;
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "portfolio-dashboard/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} responded with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchBtcPriceUsd(): Promise<number | undefined> {
  const priceFetchers = [
    async () => {
      const data = await fetchJson<{ data?: { amount?: string } }>(
        "https://api.coinbase.com/v2/prices/BTC-USD/spot"
      );
      const price = Number(data.data?.amount);

      return Number.isFinite(price) ? price : undefined;
    },
    async () => {
      const data = await fetchJson<{ price?: string }>(
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
      );
      const price = Number(data.price);

      return Number.isFinite(price) ? price : undefined;
    },
  ];

  for (const fetchPrice of priceFetchers) {
    try {
      const price = await fetchPrice();

      if (price !== undefined) {
        return price;
      }
    } catch (error) {
      console.warn("Failed to fetch BTC/USD price from one source.", error);
    }
  }

  console.error("Failed to fetch BTC/USD price, using database price.");
  return undefined;
}

async function fetchUsdToCnyRate(): Promise<number> {
  try {
    const fxData = await fetchJson<{
      rates?: { CNY?: number };
    }>("https://open.er-api.com/v6/latest/USD");

    if (typeof fxData.rates?.CNY === "number") {
      return fxData.rates.CNY;
    }
  } catch (error) {
    console.error("Failed to fetch USD/CNY rate, using fallback.", error);
  }

  return 6.8;
}

async function handleAssetStats(request: Request, env: Env): Promise<Response> {
  try {
    const [assetRows, qdiiRows] = await Promise.all([
      env.DB.prepare(
        "SELECT * FROM assets WHERE shares > 0"
      ).all<AssetRow>(),
      env.DB.prepare(
        "SELECT name, quota, updated_at FROM qdii ORDER BY updated_at DESC, name ASC"
      ).all<QdiiRow>(),
    ]);

    const results = assetRows.results ?? [];

    const hasBtcAssets = results.some((row) => row.symbol === "BTC");

    const [btcPriceUsd, usdToCny] = await Promise.all([
      hasBtcAssets ? fetchBtcPriceUsd() : Promise.resolve(undefined),
      fetchUsdToCnyRate(),
    ]);
    const btcPriceCny =
      btcPriceUsd === undefined ? undefined : btcPriceUsd * usdToCny;

    const roleStats: Record<string, number> = {};
    const symbolStats: Record<string, number> = {};
    let totalAssetCNY = 0;
    const assetsList: any[] = [];

    for (const row of results) {
      const unitPrice =
        row.symbol === "BTC" && btcPriceCny !== undefined
          ? btcPriceCny
          : row.market_price;
      const originalValue = row.shares * unitPrice;
      const valueInCNY =
        row.symbol === "USD" ? originalValue * usdToCny : originalValue;

      roleStats[row.Role] = (roleStats[row.Role] ?? 0) + valueInCNY;
      symbolStats[row.symbol] = (symbolStats[row.symbol] ?? 0) + valueInCNY;
      totalAssetCNY += valueInCNY;

      assetsList.push({
        symbol: row.symbol,
        name: row.name || row.symbol,
        shares: row.shares,
        market_price: row.symbol === "BTC" && btcPriceCny !== undefined ? btcPriceCny : row.market_price,
        value_cny: Number(valueInCNY.toFixed(2)),
        role: row.Role,
      });
    }

    assetsList.sort((a, b) => b.value_cny - a.value_cny);

    const toSortedStats = (groupedStats: Record<string, number>): ChartStat[] =>
      Object.entries(groupedStats)
        .map(([label, value]) => ({
          label,
          value: Number(value.toFixed(2)),
        }))
        .sort((a, b) => b.value - a.value);

    const stats_by_role = toSortedStats(roleStats);
    const stats_by_symbol = toSortedStats(symbolStats);

    return new Response(
      JSON.stringify({
        total_cny: Number(totalAssetCNY.toFixed(2)),
        usd_rate: usdToCny,
        btc_price_cny: btcPriceCny,
        stats_by_role,
        stats_by_symbol,
        assets: assetsList,
        qdii: qdiiRows.results ?? [],
      }),
      { headers: jsonHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/assets-stats") {
      return handleAssetStats(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
