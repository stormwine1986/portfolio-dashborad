export default {
  async fetch(request, env) {
    // 允许跨域（如果前后端分离）
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    try {
      // 1. 从 D1 数据库查询所有持仓数据
      // 假设你的表名叫 assets
      const { results } = await env.DB.prepare(
        "SELECT name, shares, market_price, symbol, Role FROM assets WHERE shares > 0"
      ).all();

      // 2. 获取最新汇率 (以 USD/CNY = 7.25 为兜底，也可以 fetch 外部 API)
      let usdToCny = 6.80; 
      try {
        const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD");
        const fxData = await fxResponse.json();
        if (fxData && fxData.rates && fxData.rates.CNY) {
          usdToCny = fxData.rates.CNY;
        }
      } catch (e) {
        console.error("汇率获取失败，使用默认汇率", e);
      }

      // 3. 按 Role 统计 CNY 总额
      const roleStats = {};
      let totalAssetCNY = 0;

      results.forEach((row) => {
        // 计算当前项的本币价值
        const originalValue = row.shares * row.market_price;
        // 统一转换为 CNY
        const valueInCNY = row.symbol === "USD" ? originalValue * usdToCny : originalValue;

        // 按 Role 累加
        if (!roleStats[row.Role]) {
          roleStats[row.Role] = 0;
        }
        roleStats[row.Role] += valueInCNY;
        totalAssetCNY += valueInCNY;
      });

      // 4. 格式化数据，保留两位小数
      const chartData = Object.keys(roleStats).map((role) => ({
        role: role,
        value: parseFloat(roleStats[role].toFixed(2)),
      }));

      return new Response(
        JSON.stringify({
          total_cny: parseFloat(totalAssetCNY.toFixed(2)),
          usd_rate: usdToCny,
          stats: chartData,
        }),
        { headers }
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers,
      });
    }
  },
};