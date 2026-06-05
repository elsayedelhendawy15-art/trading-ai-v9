// ============================================================
// TRADING AI PRO V13 - AI INSTITUTIONAL SMC++
// Smart Money Score | FVG | CHOCH/BOS | Liquidity Strength
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059';
const TELEGRAM_BOT_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI';

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
  AI_LIQUIDITY_THRESHOLD: 40
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let messageQueue = [];
let isProcessingQueue = false;
let dataCache = new Map();

const WATCH_LIST = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON',
  'SUI', 'NEAR', 'APT', 'FET', 'RNDR', 'OP', 'ARB', 'LTC', 'BCH', 'SHIB',
  'DOGE', 'PEPE', 'WIF', 'FLOKI', 'BONK'
];

// ========== EMA ==========
function ema(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let e = data[0];
  for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}

// ========== RSI ==========
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

// ========== MACD ==========
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

// ========== ATR ==========
function calculateATR(data, period = CONFIG.ATR_PERIOD) {
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

// ========== Liquidity Sweep ==========
function liquiditySweep(data) {
  const last = data[data.length - 1];
  const lookback = Math.min(CONFIG.LIQUIDITY_LOOKBACK, data.length - 5);
  const highs = data.slice(-lookback, -1).map(d => d.high);
  const lows = data.slice(-lookback, -1).map(d => d.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  return {
    buySideSweep: last.high > maxHigh && last.close < maxHigh,
    sellSideSweep: last.low < minLow && last.close > minLow
  };
}

// ========== Fair Value Gap (FVG الحقيقي) ==========
function detectFVG(data) {
  if (data.length < 5) return null;
  const gaps = [];
  for (let i = 2; i < data.length; i++) {
    const prev = data[i - 2];
    const curr = data[i];
    if (prev.high < curr.low) {
      gaps.push({ type: "BULLISH_FVG", low: prev.high, high: curr.low });
    }
    if (prev.low > curr.high) {
      gaps.push({ type: "BEARISH_FVG", low: curr.high, high: prev.low });
    }
  }
  return gaps[gaps.length - 1] || null;
}

// ========== Liquidity Strength Engine ==========
function liquidityStrength(data) {
  const last = data[data.length - 1];
  const lookback = Math.min(30, data.length - 5);
  const highs = data.slice(-lookback).map(d => d.high);
  const lows = data.slice(-lookback).map(d => d.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  let strength = 0;
  if (last.high > max) strength += 50;
  if (last.low < min) strength += 50;
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  if (body / range > 0.6) strength += 20;
  return strength;
}

// ========== Market Structure V2 (CHOCH + BOS احترافي) ==========
function marketStructureV2(data) {
  if (data.length < 30) return { BOS_UP: false, BOS_DOWN: false, CHOCH: false, trend: "RANGE" };
  const highs = [];
  const lows = [];
  for (let i = 2; i < data.length - 2; i++) {
    if (data[i].high > data[i-1].high && data[i].high > data[i+1].high) highs.push(data[i].high);
    if (data[i].low < data[i-1].low && data[i].low < data[i+1].low) lows.push(data[i].low);
  }
  if (highs.length < 2 || lows.length < 2) return { BOS_UP: false, BOS_DOWN: false, CHOCH: false, trend: "RANGE" };
  const lastHigh = highs[highs.length-1];
  const prevHigh = highs[highs.length-2];
  const lastLow = lows[lows.length-1];
  const prevLow = lows[lows.length-2];
  const BOS_UP = lastHigh > prevHigh;
  const BOS_DOWN = lastLow < prevLow;
  const CHOCH = (BOS_UP && lastLow < prevLow) || (BOS_DOWN && lastHigh > prevHigh);
  let trend = "RANGE";
  if (BOS_UP && !BOS_DOWN && lastLow > prevLow) trend = "UP";
  if (BOS_DOWN && !BOS_UP && lastHigh < prevHigh) trend = "DOWN";
  return { BOS_UP, BOS_DOWN, CHOCH, trend };
}

// ========== Smart Money Score (0-100) ==========
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

// ========== AI Final Filter ==========
function aiFilter(score, fvg, liqStrength) {
  if (score < CONFIG.AI_SCORE_THRESHOLD) return false;
  if (liqStrength < CONFIG.AI_LIQUIDITY_THRESHOLD) return false;
  if (!fvg) return false;
  return true;
}

// ========== Anti-Noise ==========
function antiNoiseFilter(data) {
  const last10 = data.slice(-10);
  const range = Math.max(...last10.map(d => d.high)) - Math.min(...last10.map(d => d.low));
  const avgPrice = last10.reduce((a, b) => a + b.close, 0) / 10;
  const noise = range / avgPrice;
  return noise < CONFIG.MAX_NOISE_PERCENT;
}

// ========== Candle Strength ==========
function candleStrengthFilter(data) {
  const last = data[data.length - 1];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  return body / range > CONFIG.MIN_CANDLE_BODY_RATIO;
}

// ========== Get Data with Cache ==========
async function getData(symbol, interval = '15m', limit = 150) {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  const now = Date.now();
  if (dataCache.has(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    if (now - cached.timestamp < CONFIG.CACHE_TTL_MS) return cached.data;
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

// ========== Market Regime ==========
function detectMarketRegime(data) {
  const closes = data.map(d => d.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  if (ema20 > ema50) return "TREND_BULL";
  if (ema20 < ema50) return "TREND_BEAR";
  return "RANGE";
}

// ========== Send Telegram ==========
async function sendTelegram(chatId, text, keyboard = null) {
  if (Date.now() - lastSend < CONFIG.ANTI_SPAM_MS) return;
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const body = { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch(e) {}
}

// ========== Position Sizing ==========
function calculatePositionSize(balance, entry, sl) {
  const riskAmount = balance * (CONFIG.ACCOUNT_RISK_PERCENT / 100);
  const riskPerUnit = Math.abs(entry - sl);
  const positionSize = riskAmount / riskPerUnit;
  return { positionSize, riskAmount };
}

// ========== Generate Entry ==========
function generateEntry(data, trend) {
  const last = data[data.length - 1];
  const atr = calculateATR(data);
  if (!atr) return null;
  if (trend === "UP") {
    return {
      side: "LONG",
      entry: last.close,
      sl: last.close - atr,
      tp1: last.close + atr * CONFIG.TP_ATR_MULTIPLIER[0],
      tp2: last.close + atr * CONFIG.TP_ATR_MULTIPLIER[1],
      tp3: last.close + atr * CONFIG.TP_ATR_MULTIPLIER[2]
    };
  }
  return {
    side: "SHORT",
    entry: last.close,
    sl: last.close + atr,
    tp1: last.close - atr * CONFIG.TP_ATR_MULTIPLIER[0],
    tp2: last.close - atr * CONFIG.TP_ATR_MULTIPLIER[1],
    tp3: last.close - atr * CONFIG.TP_ATR_MULTIPLIER[2]
  };
}

// ========== Process Coin (V13 AI Logic) ==========
async function processCoin(coin, kv) {
  try {
    const symbol = coin + 'USDT';
    
    // Cooldown check
    let cooldown = {};
    if (kv) {
      const raw = await kv.get('COOLDOWN');
      if (raw) cooldown = JSON.parse(raw);
    }
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < CONFIG.COOLDOWN_HOURS * 60 * 60 * 1000) return;
    
    // Daily limit
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return;
    
    // Get data
    const data1h = await getData(symbol, '1h', 100);
    const data15m = await getData(symbol, '15m', 150);
    if (!data1h || !data15m) return;
    
    // Regime filter
    const regime = detectMarketRegime(data1h);
    if (regime === "RANGE") return;
    
    // Noise filter
    if (!antiNoiseFilter(data15m)) return;
    
    // Candle strength
    if (!candleStrengthFilter(data15m)) return;
    
    // V13 AI Components
    const closes = data15m.map(d => d.close);
    const rsiVal = rsi(closes);
    const macdData = macd(closes);
    const structureV2 = marketStructureV2(data15m);
    const sweep = liquiditySweep(data15m);
    const fvg = detectFVG(data15m);
    const liqStrength = liquidityStrength(data15m);
    
    // Smart Money Score
    const smScore = smartMoneyScore({
      structure: structureV2.trend,
      sweep,
      macdData,
      rsiVal,
      fvg
    });
    
    // AI Filter
    if (!aiFilter(smScore, fvg, liqStrength)) return;
    
    // Generate entry
    const entry = generateEntry(data15m, structureV2.trend);
    if (!entry) return;
    
    // Position sizing
    const { positionSize, riskAmount } = calculatePositionSize(10000, entry.entry, entry.sl);
    
    // Build message
    const msg = `🧠 *V13 AI INSTITUTIONAL SMC++* 🧠\n━━━━━━━━━━━━━━━━━━━━\n🪙 *${coin}/USDT*\n🎯 *${entry.side}*\n💰 *$${entry.entry.toFixed(2)}*\n📊 *AI Score: ${smScore}/100*\n\n🎯 TP1: *$${entry.tp1.toFixed(2)}*\n🎯 TP2: *$${entry.tp2.toFixed(2)}*\n🎯 TP3: *$${entry.tp3.toFixed(2)}*\n🛑 SL: *$${entry.sl.toFixed(2)}*\n📐 R/R: *1:${CONFIG.TP_ATR_MULTIPLIER[2]}*\n\n📊 *Risk:* ${CONFIG.ACCOUNT_RISK_PERCENT}% (\$${riskAmount.toFixed(2)}) | *Size:* ${positionSize.toFixed(4)} ${coin}\n\n📌 *AI Analysis:*\n• Structure: *${structureV2.trend}* | CHOCH: *${structureV2.CHOCH ? '✅' : '❌'}*\n• Liquidity Sweep: *${sweep.buySideSweep || sweep.sellSideSweep ? '✅' : '❌'}*\n• FVG: *${fvg ? `✅ ${fvg.type}` : '❌'}*\n• Momentum: *${macdData.crossUp || macdData.crossDown ? '✅' : '❌'}*\n• Liquidity Strength: *${liqStrength}%*\n\n🤖 *AI Filter Passed*\n⚡ *Institutional Grade | Auto-Tracked*`;
    
    await sendTelegram(TELEGRAM_CHAT_ID, msg);
    
    // Save to KV
    if (kv) {
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
      
      let stats = await kv.get('STATS');
      let statsObj = stats ? JSON.parse(stats) : { total: 0, signals: [] };
      statsObj.total++;
      statsObj.signals.push({ 
        coin, side: entry.side, entry: entry.entry, 
        aiScore: smScore, structure: structureV2.trend, 
        fvg: !!fvg, timestamp: Date.now() 
      });
      if (statsObj.signals.length > 200) statsObj.signals.shift();
      await kv.put('STATS', JSON.stringify(statsObj));
    }
    
  } catch(e) { console.error(`Error ${coin}:`, e); }
}

// ========== Market Scanner ==========
async function marketScanner(kv) {
  console.log('🧠 V13 AI Institutional SMC++ Scanner Starting...');
  for (let i = 0; i < WATCH_LIST.length; i += CONFIG.BATCH_SIZE) {
    const batch = WATCH_LIST.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(coin => processCoin(coin, kv)));
    await delay(CONFIG.DELAY);
  }
  console.log('✅ V13 AI Institutional SMC++ Complete');
}

// ========== Dashboard ==========
async function getDashboardHTML(kv) {
  let stats = { total: 0, signals: [] };
  if (kv) {
    const raw = await kv.get('STATS');
    if (raw) stats = JSON.parse(raw);
  }
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trading AI Pro V13 - AI Institutional SMC++</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%); color: #fff; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 10px; font-size: 2em; background: linear-gradient(135deg, #00b4d8, #90e0ef); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { text-align: center; color: #00b4d8; margin-bottom: 30px; font-size: 14px; }
    .badge { background: linear-gradient(135deg, #00b4d8, #0077b6); padding: 5px 15px; border-radius: 20px; font-size: 12px; display: inline-block; margin-bottom: 20px; }
    .stat-card { background: rgba(255,255,255,0.1); border-radius: 15px; padding: 20px; margin-bottom: 20px; text-align: center; }
    .stat-card .value { font-size: 48px; font-weight: bold; color: #00b4d8; }
    .ai-score { color: #00ff88; }
    table { width: 100%; background: rgba(255,255,255,0.05); border-radius: 15px; overflow: hidden; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { color: #00b4d8; }
    .status-long { color: #00ff88; }
    .status-short { color: #ff4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧠 Trading AI Pro V13</h1>
    <div class="subtitle">AI INSTITUTIONAL SMC++ | SMART MONEY SCORE | FVG | CHOCH/BOS</div>
    <div style="text-align: center;"><span class="badge">🤖 AI Score | 🕳 FVG | 🧲 Liquidity Strength | 📊 CHOCH/BOS</span></div>
    <div class="stat-card">
      <h3>🎯 AI Institutional Signals</h3>
      <div class="value">${stats.total}</div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 20px;">
      <div class="stat-card"><h3>🧠 AI Threshold</h3><div class="ai-score">≥70%</div></div>
      <div class="stat-card"><h3>🕳 FVG Required</h3><div class="ai-score">✅ YES</div></div>
      <div class="stat-card"><h3>🧲 Liquidity</h3><div class="ai-score">≥40%</div></div>
    </div>
    <table>
      <thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>AI Score</th><th>Structure</th><th>FVG</th><th>Time</th></tr></thead>
      <tbody>
        ${stats.signals.slice(-20).reverse().map(s => `<tr><td><strong>${s.coin}</strong></td><td class="status-${s.side?.toLowerCase()}">${s.side}</td><td>$${s.entry?.toFixed(2)}</td><td class="ai-score">${s.aiScore}%</td><td>${s.structure || 'UP'}</td><td>${s.fvg ? '✅' : '❌'}</td><td>${new Date(s.timestamp).toLocaleString()}</td><\/tr>`).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

// ========== Commands ==========
const MENU = {
  inline_keyboard: [
    [{ text: "💰 BTC", callback_data: "btc" }, { text: "🚀 TOP", callback_data: "top" }],
    [{ text: "🎭 FEAR", callback_data: "fear" }, { text: "🔍 SCAN", callback_data: "scan" }],
    [{ text: "📊 STATS", callback_data: "stats" }, { text: "🧠 V13 AI", callback_data: "about" }]
  ]
};

async function getBTC() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const data = await res.json();
  return parseFloat(data.price);
}

async function getTopMovers() {
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  const data = await res.json();
  return data.filter(i => i.symbol.endsWith('USDT'))
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, 5)
    .map(i => ({ s: i.symbol.replace('USDT', ''), c: parseFloat(i.priceChangePercent) }));
}

async function getFearIndex() {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    const d = await res.json();
    return { val: d.data[0].value, cls: d.data[0].value_classification };
  } catch { return { val: 50, cls: "محايد" }; }
}

// ========== Main Worker ==========
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
    
    if (url.pathname === '/stats') {
      let stats = { total: 0 };
      if (kv) {
        const raw = await kv.get('STATS');
        if (raw) stats = JSON.parse(raw);
      }
      return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } });
    }
    
    if (url.pathname === '/scan') {
      ctx.waitUntil(marketScanner(kv));
      return new Response('🧠 V13 AI Scanning...', { status: 200 });
    }
    
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        
        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data;
          
          if (data === 'btc') {
            const btc = await getBTC();
            await sendTelegram(cb.message.chat.id, `💰 *BTC/USDT*\n💵 *$${btc.toLocaleString()}*`);
          } else if (data === 'top') {
            const movers = await getTopMovers();
            await sendTelegram(cb.message.chat.id, `🚀 *أفضل الصاعدين*\n${movers.map(m => `🟢 *${m.s}*: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (data === 'fear') {
            const fear = await getFearIndex();
            await sendTelegram(cb.message.chat.id, `🎭 *مؤشر الخوف*\n📊 ${fear.val}/100 (${fear.cls})`);
          } else if (data === 'scan') {
            await sendTelegram(cb.message.chat.id, `🧠 *V13 AI Scan*\n📊 ${WATCH_LIST.length} coins\n🤖 AI Score Threshold: ${CONFIG.AI_SCORE_THRESHOLD}%`);
            ctx.waitUntil(marketScanner(kv));
          } else if (data === 'stats') {
            let stats = { total: 0 };
            if (kv) {
              const raw = await kv.get('STATS');
              if (raw) stats = JSON.parse(raw);
            }
            await sendTelegram(cb.message.chat.id, `📊 *V13 AI STATS*\n🎯 Total Signals: ${stats.total}\n🧠 Avg AI Score: ${stats.signals?.slice(-20).reduce((a,b)=>a+b.aiScore,0)/20 || 0}%`);
          } else if (data === 'about') {
            await sendTelegram(cb.message.chat.id, `🧠 *V13 AI INSTITUTIONAL SMC++*\n✅ Smart Money Score (0-100)\n✅ Fair Value Gap (FVG)\n✅ CHOCH + BOS with confirmation\n✅ Liquidity Strength Engine\n✅ AI Signal Filter\n✅ Candle Strength Filter\n✅ Institutional Grade`);
          }
          
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { method: 'POST', body: JSON.stringify({ callback_query_id: cb.id }) });
          return new Response('OK');
        }
        
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim().toUpperCase();
          
          if (text === '/START') {
            await sendTelegram(chatId, `🧠 *V13 AI INSTITUTIONAL SMC++* 🧠\n━━━━━━━━━━━━━━━━━━━━━\n✅ *AI-Powered Institutional Bot*\n\n📊 *AI Features:*\n• Smart Money Score (0-100)\n• Fair Value Gap (FVG)\n• CHOCH + BOS with confirmation\n• Liquidity Strength Engine\n• AI Signal Filter\n\n📈 *Performance:*\n• Less signals, higher quality\n• Institutional entry logic\n• Hedge fund grade filtering\n\n📊 Dashboard: https://${url.hostname}/dashboard\n\n🤖 *AI Threshold: ${CONFIG.AI_SCORE_THRESHOLD}%*`, MENU);
          } else {
            await sendTelegram(chatId, `📋 *V13 AI Commands*\n/start - Main Menu\n/scan - AI Scan\n/stats - Statistics\n/btc - Bitcoin\n/top - Top Gainers\n/fear - Fear Index`);
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
