interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface AssetRow {
  shares: number;
  market_price: number;
  symbol: string;
  Role: string;
}

interface ChartStat {
  label: string;
  value: number;
}

const jsonHeaders = {
  "Content-Type": "application/json",
};

async function handleAssetStats(request: Request, env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT shares, market_price, symbol, Role FROM assets WHERE shares > 0"
    ).all<AssetRow>();

    let usdToCny = 6.8;

    try {
      const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD");
      const fxData = (await fxResponse.json()) as {
        rates?: { CNY?: number };
      };

      if (typeof fxData.rates?.CNY === "number") {
        usdToCny = fxData.rates.CNY;
      }
    } catch (error) {
      console.error("Failed to fetch USD/CNY rate, using fallback.", error);
    }

    const roleStats: Record<string, number> = {};
    const symbolStats: Record<string, number> = {};
    let totalAssetCNY = 0;

    for (const row of results ?? []) {
      const originalValue = row.shares * row.market_price;
      const valueInCNY = row.symbol === "USD" ? originalValue * usdToCny : originalValue;

      roleStats[row.Role] = (roleStats[row.Role] ?? 0) + valueInCNY;
      symbolStats[row.symbol] = (symbolStats[row.symbol] ?? 0) + valueInCNY;
      totalAssetCNY += valueInCNY;
    }

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
        stats_by_role,
        stats_by_symbol,
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

    return env.ASSETS.fetch(request);
  },
};
