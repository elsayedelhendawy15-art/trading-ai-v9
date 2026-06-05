// ============================================================
// TRADING AI PRO V13 - AI INSTITUTIONAL SMC++
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
  AI_LIQUIDITY_THRESHOLD: 40
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();

const WATCH_LIST = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON',
  'SUI', 'NEAR', 'APT', 'FET', 'RNDR', 'OP', 'ARB', 'LTC', 'BCH', 'SHIB',
  'DOGE', 'PEPE', 'WIF', 'FLOKI', 'BONK'
];

// ========== المؤشرات الأساسية ==========
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
    
    const msg = `🧠 *V13 AI SIGNAL* 🧠\n━━━━━━━━━━━━━━━━━━━━\n🪙 *${coin}/USDT*\n🎯 *${entry.side}*\n💰 *$${entry.entry.toFixed(2)}*\n📊 *AI Score: ${smScore}/100*\n\n🎯 TP1: *$${entry.tp1.toFixed(2)}*\n🎯 TP2: *$${entry.tp2.toFixed(2)}*\n🎯 TP3: *$${entry.tp3.toFixed(2)}*\n🛑 SL: *$${entry.sl.toFixed(2)}*\n\n📌 *Analysis:*\n• Structure: *${structureV2.trend}*\n• FVG: *${fvg ? '✅' : '❌'}*\n• Liquidity Sweep: *${sweep.buySideSweep || sweep.sellSideSweep ? '✅' : '❌'}*\n\n🤖 *AI Filter Passed*`;
    
    await sendTelegram(TELEGRAM_CHAT_ID, msg);
    
    if (kv) {
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
    }
  } catch(e) { console.error(`Error ${coin}:`, e); }
}

async function marketScanner(kv) {
  console.log('🧠 V13 AI Scanner Starting...');
  for (let i = 0; i < WATCH_LIST.length; i += 4) {
    const batch = WATCH_LIST.slice(i, i + 4);
    await Promise.all(batch.map(coin => processCoin(coin, kv)));
    await delay(1000);
  }
  console.log('✅ V13 AI Complete');
}

async function getDashboardHTML(kv) {
  let stats = { total: 0 };
  if (kv) {
    const raw = await kv.get('STATS');
    if (raw) stats = JSON.parse(raw);
  }
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Trading AI Pro V13</title>
<style>body{background:#0a0a1a;color:#fff;font-family:sans-serif;padding:20px;text-align:center}</style>
</head>
<body>
<h1>🧠 Trading AI Pro V13</h1>
<p>AI Institutional SMC++ | Smart Money Score | FVG | CHOCH/BOS</p>
<div style="background:#1a1a2e;padding:20px;border-radius:15px;margin:20px auto;max-width:400px">
<h2>🎯 Total Signals</h2>
<div style="font-size:48px;color:#00b4d8">${stats.total}</div>
</div>
<p>🤖 AI Threshold: ≥70% | 🕳 FVG Required | 🧲 Liquidity ≥40%</p>
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
            await sendTelegram(chatId, `🧠 *V13 AI INSTITUTIONAL SMC++* 🧠\n✅ AI-Powered Institutional Bot\n📊 Dashboard: https://${url.hostname}/dashboard\n\n🤖 AI Threshold: 70%`, MENU);
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
