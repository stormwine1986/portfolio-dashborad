interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DASHBOARD_USERNAME?: string;
  DASHBOARD_PASSWORD?: string;
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

function unauthorizedResponse() {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Private Dashboard", charset="UTF-8"',
    },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const expectedUsername = env.DASHBOARD_USERNAME;
  const expectedPassword = env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return false;
  }

  try {
    const encoded = authHeader.slice("Basic ".length);
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      return false;
    }

    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    return username === expectedUsername && password === expectedPassword;
  } catch {
    return false;
  }
}

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
    if (!isAuthorized(request, env)) {
      return unauthorizedResponse();
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/assets-stats") {
      return handleAssetStats(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
