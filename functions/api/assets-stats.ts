interface Env {
  DB: D1Database;
}

interface AssetRow {
  shares: number;
  market_price: number;
  symbol: string;
  Role: string;
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const { results } = await context.env.DB.prepare(
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
    let totalAssetCNY = 0;

    for (const row of results ?? []) {
      const originalValue = row.shares * row.market_price;
      const valueInCNY = row.symbol === "USD" ? originalValue * usdToCny : originalValue;

      roleStats[row.Role] = (roleStats[row.Role] ?? 0) + valueInCNY;
      totalAssetCNY += valueInCNY;
    }

    const stats = Object.entries(roleStats).map(([role, value]) => ({
      role,
      value: Number(value.toFixed(2)),
    }));

    return new Response(
      JSON.stringify({
        total_cny: Number(totalAssetCNY.toFixed(2)),
        usd_rate: usdToCny,
        stats,
      }),
      { headers }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers,
    });
  }
};
