// ============================================================
// TRADING AI PRO V13 ULTRA - النسخة الكاملة
// ============================================================

const TELEGRAM_BOT_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI';
const TELEGRAM_CHAT_ID = '-1003591113059';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 4,
  MIN_VOLUME_USD: 5000000,
  COOLDOWN_HOURS: 4,
  BATCH_SIZE: 4,
  DELAY: 1000,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 4.0],
  MAX_NOISE_PERCENT: 0.04,
  MIN_RISK_REWARD: 2.0,
  ACCOUNT_RISK_PERCENT: 1.0,
  CACHE_TTL_MS: 60000,
  MIN_CANDLE_BODY_RATIO: 0.6,
  LIQUIDITY_LOOKBACK: 30,
  AI_SCORE_THRESHOLD: 70,
  AI_LIQUIDITY_THRESHOLD: 40,
  TP1_WEIGHT: 0.3,
  TP2_WEIGHT: 0.3,
  TP3_WEIGHT: 0.4
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();

const WATCH_LIST = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON',
  'SUI', 'NEAR', 'APT', 'FET', 'RNDR', 'OP', 'ARB', 'LTC', 'BCH', 'SHIB',
  'DOGE', 'PEPE', 'WIF', 'FLOKI', 'BONK'
];

// ========== المؤشرات ==========
function ema(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let e = data[0];
  for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}

function rsi(closes, p = 14) {
  if (closes.length < p + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / p, avgL = loss / p || 0.0001;
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) {
      avgG = (avgG * (p - 1) + d) / p;
      avgL = (avgL * (p - 1)) / p;
    } else {
      avgG = (avgG * (p - 1)) / p;
      avgL = (avgL * (p - 1) - d) / p;
    }
  }
  const rs = avgG / avgL;
  return Math.round(100 - (100 / (1 + rs)));
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return { crossUp: false, crossDown: false };
  const emaFast = ema(closes.slice(-fast*2), fast);
  const emaSlow = ema(closes.slice(-slow*2), slow);
  const macdLine = emaFast - emaSlow;
  const macdValues = [];
  for (let i = slow; i < closes.length; i++) {
    const f = ema(closes.slice(0, i+1), fast);
    const s = ema(closes.slice(0, i+1), slow);
    macdValues.push(f - s);
  }
  const signalLine = macdValues.length >= signal ? ema(macdValues.slice(-signal*2), signal) : 0;
  const prevMacd = macdValues[macdValues.length-2] || 0;
  const prevSignal = signalLine;
  const currentMacd = macdLine;
  const currentSignal = signalLine;
  return {
    crossUp: prevMacd <= prevSignal && currentMacd > currentSignal,
    crossDown: prevMacd >= prevSignal && currentMacd < currentSignal
  };
}

function calculateATR(data, period = 14) {
  if (data.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
    trueRanges.push(tr);
  }
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) atr = (atr * (period - 1) + trueRanges[i]) / period;
  return atr;
}

function calculateExpectedReward(tp1, tp2, tp3, entry, sl, side) {
  let reward1, reward2, reward3;
  if (side === 'LONG') {
    reward1 = ((tp1 - entry) / entry) * 100 * CONFIG.TP1_WEIGHT;
    reward2 = ((tp2 - entry) / entry) * 100 * CONFIG.TP2_WEIGHT;
    reward3 = ((tp3 - entry) / entry) * 100 * CONFIG.TP3_WEIGHT;
  } else {
    reward1 = ((entry - tp1) / entry) * 100 * CONFIG.TP1_WEIGHT;
    reward2 = ((entry - tp2) / entry) * 100 * CONFIG.TP2_WEIGHT;
    reward3 = ((entry - tp3) / entry) * 100 * CONFIG.TP3_WEIGHT;
  }
  const risk = side === 'LONG' ? ((entry - sl) / entry) * 100 : ((sl - entry) / entry) * 100;
  const expectedReward = reward1 + reward2 + reward3;
  const riskReward = (expectedReward / risk).toFixed(2);
  return { expectedReward: expectedReward.toFixed(2), riskReward };
}

function liquiditySweep(data) {
  const last = data[data.length - 1];
  const lookback = Math.min(30, data.length - 5);
  const highs = data.slice(-lookback, -1).map(d => d.high);
  const lows = data.slice(-lookback, -1).map(d => d.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  return {
    buySideSweep: last.high > maxHigh && last.close < maxHigh,
    sellSideSweep: last.low < minLow && last.close > minLow
  };
}

function detectFVG(data) {
  if (data.length < 5) return null;
  for (let i = 2; i < data.length; i++) {
    const prev = data[i - 2];
    const curr = data[i];
    if (prev.high < curr.low) return { type: "BULLISH_FVG", low: prev.high, high: curr.low };
    if (prev.low > curr.high) return { type: "BEARISH_FVG", low: curr.high, high: prev.low };
  }
  return null;
}

function marketStructureV2(data) {
  if (data.length < 30) return { BOS_UP: false, BOS_DOWN: false, CHOCH: false, trend: "RANGE" };
  const highs = [], lows = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].high > data[i-1].high && data[i].high > data[i+1].high) highs.push(data[i].high);
    if (data[i].low < data[i-1].low && data[i].low < data[i+1].low) lows.push(data[i].low);
  }
  if (highs.length < 2 || lows.length < 2) return { BOS_UP: false, BOS_DOWN: false, CHOCH: false, trend: "RANGE" };
  const lastHigh = highs[highs.length-1], prevHigh = highs[highs.length-2];
  const lastLow = lows[lows.length-1], prevLow = lows[lows.length-2];
  const BOS_UP = lastHigh > prevHigh;
  const BOS_DOWN = lastLow < prevLow;
  const CHOCH = (BOS_UP && lastLow < prevLow) || (BOS_DOWN && lastHigh > prevHigh);
  let trend = "RANGE";
  if (BOS_UP && !BOS_DOWN && lastLow > prevLow) trend = "UP";
  if (BOS_DOWN && !BOS_UP && lastHigh < prevHigh) trend = "DOWN";
  return { BOS_UP, BOS_DOWN, CHOCH, trend };
}

function smartMoneyScore({ structure, sweep, macdData, rsiVal, fvg }) {
  let score = 0;
  if (structure === "UP") score += 20;
  if (structure === "DOWN") score += 20;
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 25;
  if (macdData.crossUp || macdData.crossDown) score += 20;
  if (rsiVal > 45 && rsiVal < 70) score += 10;
  if (fvg) score += 25;
  return Math.min(score, 100);
}

function aiFilter(score, fvg) {
  return score >= 70 && fvg !== null;
}

function antiNoiseFilter(data) {
  const last10 = data.slice(-10);
  const range = Math.max(...last10.map(d => d.high)) - Math.min(...last10.map(d => d.low));
  const avgPrice = last10.reduce((a, b) => a + b.close, 0) / 10;
  return (range / avgPrice) < 0.04;
}

function candleStrengthFilter(data) {
  const last = data[data.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  return body / range > 0.6;
}

async function getData(symbol, interval = '15m', limit = 100) {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  const now = Date.now();
  if (dataCache.has(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    if (now - cached.timestamp < 60000) return cached.data;
  }
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json();
    const formatted = data.map(c => ({ open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5] }));
    dataCache.set(cacheKey, { data: formatted, timestamp: now });
    return formatted;
  } catch { return null; }
}

function detectMarketRegime(data) {
  const closes = data.map(d => d.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  if (ema20 > ema50) return "TREND_BULL";
  if (ema20 < ema50) return "TREND_BEAR";
  return "RANGE";
}

function generateEntry(data, trend) {
  const last = data[data.length - 1];
  const atr = calculateATR(data);
  if (!atr) return null;
  if (trend === "UP") {
    return {
      side: "LONG",
      entry: last.close,
      sl: last.close - atr,
      tp1: last.close + atr * 1.5,
      tp2: last.close + atr * 2.5,
      tp3: last.close + atr * 4
    };
  }
  return {
    side: "SHORT",
    entry: last.close,
    sl: last.close + atr,
    tp1: last.close - atr * 1.5,
    tp2: last.close - atr * 2.5,
    tp3: last.close - atr * 4
  };
}

async function sendTelegram(chatId, text) {
  if (Date.now() - lastSend < 1500) return;
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch(e) {}
}

async function processCoin(coin, kv) {
  try {
    const symbol = coin + 'USDT';
    let cooldown = kv ? JSON.parse(await kv.get('COOLDOWN') || '{}') : {};
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < 4 * 60 * 60 * 1000) return;
    
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= 4) return;
    
    const data1h = await getData(symbol, '1h', 100);
    const data15m = await getData(symbol, '15m', 150);
    if (!data1h || !data15m) return;
    
    if (detectMarketRegime(data1h) === "RANGE") return;
    if (!antiNoiseFilter(data15m)) return;
    if (!candleStrengthFilter(data15m)) return;
    
    const closes = data15m.map(d => d.close);
    const rsiVal = rsi(closes);
    const macdData = macd(closes);
    const structureV2 = marketStructureV2(data15m);
    const sweep = liquiditySweep(data15m);
    const fvg = detectFVG(data15m);
    const smScore = smartMoneyScore({ structure: structureV2.trend, sweep, macdData, rsiVal, fvg });
    
    if (!aiFilter(smScore, fvg)) return;
    
    const entry = generateEntry(data15m, structureV2.trend);
    if (!entry) return;
    
    const { expectedReward, riskReward } = calculateExpectedReward(entry.tp1, entry.tp2, entry.tp3, entry.entry, entry.sl, entry.side);
    
    const msg = `🧠 *V13 ULTRA SIGNAL* 🧠\n━━━━━━━━━━━━━━━━━━━━\n🪙 *${coin}/USDT*\n🎯 *${entry.side}*\n💰 *$${entry.entry.toFixed(2)}*\n📊 *AI Score: ${smScore}/100*\n📊 *Expected Profit: +${expectedReward}%*\n📐 *Risk/Reward: 1:${riskReward}*\n\n🎯 TP1: *$${entry.tp1.toFixed(2)}* (+${((entry.tp1-entry.entry)/entry.entry*100).toFixed(2)}%)\n🎯 TP2: *$${entry.tp2.toFixed(2)}* (+${((entry.tp2-entry.entry)/entry.entry*100).toFixed(2)}%)\n🎯 TP3: *$${entry.tp3.toFixed(2)}* (+${((entry.tp3-entry.entry)/entry.entry*100).toFixed(2)}%)\n🛑 SL: *$${entry.sl.toFixed(2)}* (${((entry.sl-entry.entry)/entry.entry*100).toFixed(2)}%)\n\n📌 *AI Analysis:*\n• Structure: *${structureV2.trend}* | CHOCH: *${structureV2.CHOCH ? '✅' : '❌'}*\n• FVG: *${fvg ? `✅ ${fvg.type}` : '❌'}*\n• Liquidity Sweep: *${sweep.buySideSweep || sweep.sellSideSweep ? '✅' : '❌'}*\n• Momentum: *${macdData.crossUp || macdData.crossDown ? '✅' : '❌'}*\n\n🤖 *AI Filter Passed* | ⚡ *Auto-Tracked*`;
    
    await sendTelegram(TELEGRAM_CHAT_ID, msg);
    
    if (kv) {
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
      
      let stats = await kv.get('STATS');
      let statsObj = stats ? JSON.parse(stats) : { total: 0, signals: [], wins: 0, losses: 0, totalProfit: 0 };
      statsObj.total++;
      statsObj.signals.push({ coin, side: entry.side, entry: entry.entry, aiScore: smScore, expectedReward, timestamp: Date.now() });
      if (statsObj.signals.length > 200) statsObj.signals.shift();
      await kv.put('STATS', JSON.stringify(statsObj));
    }
  } catch(e) { console.error(`Error ${coin}:`, e); }
}

async function marketScanner(kv) {
  console.log('🧠 V13 ULTRA Scanner Starting...');
  for (let i = 0; i < WATCH_LIST.length; i += 4) {
    const batch = WATCH_LIST.slice(i, i + 4);
    await Promise.all(batch.map(coin => processCoin(coin, kv)));
    await delay(1000);
  }
  console.log('✅ V13 ULTRA Complete');
}

async function getDashboardHTML(kv) {
  let stats = { total: 0, signals: [], wins: 0, losses: 0, totalProfit: 0 };
  if (kv) {
    const raw = await kv.get('STATS');
    if (raw) stats = JSON.parse(raw);
  }
  
  const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : 0;
  const avgProfit = stats.signals.length > 0 ? (stats.signals.reduce((a,b) => a + (parseFloat(b.expectedReward) || 0), 0) / stats.signals.length).toFixed(2) : 0;
  
  // أفضل عملة
  const coinStats = {};
  stats.signals.forEach(s => {
    if (!coinStats[s.coin]) coinStats[s.coin] = { count: 0, totalScore: 0 };
    coinStats[s.coin].count++;
    coinStats[s.coin].totalScore += s.aiScore || 0;
  });
  const bestCoin = Object.entries(coinStats).sort((a,b) => (b[1].totalScore/b[1].count) - (a[1].totalScore/a[1].count))[0]?.[0] || 'N/A';
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trading AI Pro V13 ULTRA - Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%); color: #fff; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 10px; font-size: 2em; background: linear-gradient(135deg, #00b4d8, #90e0ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { text-align: center; color: #00b4d8; margin-bottom: 30px; font-size: 14px; }
    .badge { background: linear-gradient(135deg, #00b4d8, #0077b6); padding: 5px 15px; border-radius: 20px; font-size: 12px; display: inline-block; margin-bottom: 20px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: rgba(255,255,255,0.1); border-radius: 15px; padding: 20px; text-align: center; backdrop-filter: blur(10px); }
    .stat-card .value { font-size: 32px; font-weight: bold; color: #00ff88; }
    .stat-card .label { font-size: 14px; opacity: 0.8; margin-top: 5px; }
    .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px; }
    .chart-card { background: rgba(255,255,255,0.05); border-radius: 15px; padding: 20px; }
    .chart-card h3 { margin-bottom: 15px; color: #00b4d8; }
    canvas { max-height: 250px; }
    table { width: 100%; background: rgba(255,255,255,0.05); border-radius: 15px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { color: #00b4d8; }
    .status-long { color: #00ff88; }
    .status-short { color: #ff4444; }
  </style>
</head>
<body>
<div class="container">
  <h1>🧠 Trading AI Pro V13 ULTRA</h1>
  <div class="subtitle">AI Institutional SMC++ | Smart Money Score | FVG | CHOCH/BOS</div>
  <div style="text-align: center;"><span class="badge">🔥 Expected Profit | Risk/Reward | Advanced Stats 🔥</span></div>
  
  <div class="stats-grid">
    <div class="stat-card"><div class="value">${stats.total}</div><div class="label">Total Signals</div></div>
    <div class="stat-card"><div class="value">${winRate}%</div><div class="label">Win Rate</div></div>
    <div class="stat-card"><div class="value">${stats.wins}</div><div class="label">Wins</div></div>
    <div class="stat-card"><div class="value">${stats.losses}</div><div class="label">Losses</div></div>
    <div class="stat-card"><div class="value">+${stats.totalProfit}%</div><div class="label">Total Profit</div></div>
    <div class="stat-card"><div class="value">+${avgProfit}%</div><div class="label">Avg Profit/Signal</div></div>
    <div class="stat-card"><div class="value">${bestCoin}</div><div class="label">Best Coin</div></div>
    <div class="stat-card"><div class="value">${CONFIG.AI_SCORE_THRESHOLD}%</div><div class="label">AI Threshold</div></div>
  </div>
  
  <div class="chart-grid">
    <div class="chart-card"><h3>📈 Profit Progression</h3><canvas id="profitChart"></canvas></div>
    <div class="chart-card"><h3>🎯 Win/Loss Ratio</h3><canvas id="winLossChart"></canvas></div>
  </div>
  
  <h3 style="margin: 20px 0 10px;">📊 Recent Signals</h3>
  <table><thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>AI Score</th><th>Expected Profit</th><th>Time</th></tr></thead>
  <tbody>${stats.signals.slice(-20).reverse().map(s => `<tr><td><strong>${s.coin}</strong></td><td class="status-${s.side?.toLowerCase()}">${s.side}</td><td>$${s.entry?.toFixed(2)}</td><td>${s.aiScore}%</td><td class="status-${s.side?.toLowerCase()}">+${s.expectedReward || 0}%</td><td>${new Date(s.timestamp).toLocaleString()}</td></tr>`).join('')}</tbody>
  </table>
</div>
<script>
const profitData = ${JSON.stringify(stats.signals.slice(-30).map(s => parseFloat(s.expectedReward) || 0))};
new Chart(document.getElementById('profitChart'), {
  type: 'line',
  data: { datasets: [{ label: 'Expected Profit %', data: profitData, borderColor: '#00ff88', fill: false }] },
  options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } } }
});
new Chart(document.getElementById('winLossChart'), {
  type: 'doughnut',
  data: { labels: ['Wins', 'Losses'], datasets: [{ data: [${stats.wins}, ${stats.losses}], backgroundColor: ['#00ff88', '#ff4444'] }] },
  options: { responsive: true, plugins: { legend: { labels: { color: '#fff' } } } }
});
</script>
</body>
</html>`;
}

const MENU = {
  inline_keyboard: [[{ text: "💰 BTC", callback_data: "btc" }, { text: "🚀 TOP", callback_data: "top" }]]
};

async function getBTC() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function getTopMovers() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data = await res.json();
  return data.filter(i => i.symbol.endsWith('USDT')).slice(0, 5).map(i => ({ s: i.symbol.replace('USDT', ''), c: parseFloat(i.priceChangePercent) }));
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(marketScanner(env.SIGNALS_KV));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env.SIGNALS_KV;
    
    if (url.pathname === '/dashboard' || url.pathname === '/') {
      return new Response(await getDashboardHTML(kv), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.callback_query) {
          const cb = update.callback_query;
          if (cb.data === 'btc') {
            const btc = await getBTC();
            await sendTelegram(cb.message.chat.id, `💰 *BTC*\n$${btc.toLocaleString()}`);
          } else if (cb.data === 'top') {
            const movers = await getTopMovers();
            await sendTelegram(cb.message.chat.id, `🚀 *أفضل الصاعدين*\n${movers.map(m => `🟢 ${m.s}: +${m.c.toFixed(2)}%`).join('\n')}`);
          }
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { method: 'POST', body: JSON.stringify({ callback_query_id: cb.id }) });
          return new Response('OK');
        }
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim().toUpperCase();
          if (text === '/START') {
            await sendTelegram(chatId, `🧠 *V13 ULTRA* 🧠\n━━━━━━━━━━━━━━━━━━━━━\n✅ AI Institutional SMC++\n✅ Expected Profit & Risk/Reward\n✅ Advanced Statistics\n📊 Dashboard: https://${url.hostname}/dashboard\n\n🤖 AI Threshold: 70%`, MENU);
          } else {
            await sendTelegram(chatId, `✅ مرحباً! أرسل /start للقائمة`);
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
