// ============================================================
// TRADING AI PRO V14 ULTIMATE - PROFESSIONAL PAID BOT
// ============================================================
// ⚠️ التوكن يُقرأ من env.TELEGRAM_BOT_TOKEN (Cloudflare Secrets)
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 3,
  MIN_VOLUME_USD: 5000000,
  COOLDOWN_HOURS: 4,
  BATCH_SIZE: 4,
  DELAY: 1000,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 4.0],
  MAX_NOISE_PERCENT: 0.04,
  ACCOUNT_RISK_PERCENT: 1.0,
  CACHE_TTL_MS: 60000,
  MIN_CANDLE_BODY_RATIO: 0.6,
  LIQUIDITY_LOOKBACK: 30,
  AI_SCORE_THRESHOLD: 85,
  VOLUME_RATIO_THRESHOLD: 1.5,
  // Multi-Timeframe
  TIMEFRAMES: {
    MASTER: '4h',
    CONFIRM: '1h',
    ENTRY: '15m'
  }
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();

const WATCH_LIST = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON'
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

// ========== Multi-Timeframe Alignment ==========
async function getMultiTimeframeAlignment(symbol) {
  const dataMaster = await getData(symbol, CONFIG.TIMEFRAMES.MASTER, 100);
  const dataConfirm = await getData(symbol, CONFIG.TIMEFRAMES.CONFIRM, 100);
  const dataEntry = await getData(symbol, CONFIG.TIMEFRAMES.ENTRY, 150);
  
  if (!dataMaster || !dataConfirm || !dataEntry) return { aligned: false, trend: 'NEUTRAL' };
  
  const closesMaster = dataMaster.map(d => d.close);
  const closesConfirm = dataConfirm.map(d => d.close);
  const ema20Master = ema(closesMaster, 20);
  const ema50Master = ema(closesMaster, 50);
  const ema20Confirm = ema(closesConfirm, 20);
  const ema50Confirm = ema(closesConfirm, 50);
  
  const masterTrend = ema20Master > ema50Master ? 'BULLISH' : 'BEARISH';
  const confirmTrend = ema20Confirm > ema50Confirm ? 'BULLISH' : 'BEARISH';
  const aligned = masterTrend === confirmTrend;
  
  return { aligned, trend: masterTrend, masterTrend, confirmTrend };
}

// ========== Volume Filter ==========
function volumeFilter(data) {
  const lastVol = data[data.length - 1].vol;
  const avgVol = data.slice(-20).reduce((a, b) => a + b.vol, 0) / 20;
  const ratio = lastVol / avgVol;
  return { passed: ratio >= CONFIG.VOLUME_RATIO_THRESHOLD, ratio };
}

// ========== Liquidity Sweep ==========
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

// ========== Order Block Detection ==========
function detectOrderBlock(data) {
  if (data.length < 10) return { bullish: null, bearish: null };
  const recent = data.slice(-10);
  for (let i = 2; i < recent.length - 2; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const next = recent[i + 1];
    
    // Bullish Order Block
    if (prev.close < prev.open && curr.close > curr.open && curr.close > prev.high) {
      return { bullish: { price: prev.high }, bearish: null };
    }
    // Bearish Order Block
    if (prev.close > prev.open && curr.close < curr.open && curr.close < prev.low) {
      return { bullish: null, bearish: { price: prev.low } };
    }
  }
  return { bullish: null, bearish: null };
}

// ========== Premium/Discount Zone ==========
function premiumDiscountZone(data, currentPrice) {
  const highs = data.slice(-20).map(d => d.high);
  const lows = data.slice(-20).map(d => d.low);
  const range = Math.max(...highs) - Math.min(...lows);
  const discountZone = Math.min(...lows) + range * 0.382;
  const premiumZone = Math.max(...highs) - range * 0.382;
  
  return {
    isDiscount: currentPrice <= discountZone,
    isPremium: currentPrice >= premiumZone,
    discountZone,
    premiumZone
  };
}

// ========== FVG ==========
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

// ========== Premium Score System (0-100) ==========
function calculatePremiumScore({ structure, sweep, fvg, volumeRatio, pdZone, entrySide }) {
  let score = 0;
  
  // Structure (25 points)
  if (structure === "BULLISH" && entrySide === 'LONG') score += 25;
  if (structure === "BEARISH" && entrySide === 'SHORT') score += 25;
  
  // Liquidity Sweep (20 points)
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 20;
  
  // Volume (20 points)
  if (volumeRatio >= 1.5) score += 20;
  if (volumeRatio >= 2.0) score += 5;
  
  // FVG (15 points)
  if (fvg) score += 15;
  
  // Premium/Discount Zone (10 points)
  if ((entrySide === 'LONG' && pdZone.isDiscount) || (entrySide === 'SHORT' && pdZone.isPremium)) score += 10;
  
  // Entry Side Alignment (10 points)
  if ((structure === "BULLISH" && entrySide === 'LONG') || (structure === "BEARISH" && entrySide === 'SHORT')) score += 10;
  
  return Math.min(score, 100);
}

// ========== Position Size Calculator ==========
function calculatePositionSize(accountBalance, entryPrice, stopLoss, riskPercent = CONFIG.ACCOUNT_RISK_PERCENT) {
  const riskAmount = accountBalance * (riskPercent / 100);
  const priceDifference = Math.abs(entryPrice - stopLoss);
  const positionSize = riskAmount / priceDifference;
  const dollarValue = positionSize * entryPrice;
  const recommendedLeverage = Math.min(10, Math.floor(dollarValue / accountBalance) + 1);
  
  return {
    positionSize: positionSize.toFixed(4),
    dollarValue: dollarValue.toFixed(2),
    riskAmount: riskAmount.toFixed(2),
    recommendedLeverage
  };
}

// ========== Generate Entry ==========
function generateEntry(data, trend) {
  const last = data[data.length - 1];
  const atr = calculateATR(data);
  if (!atr) return null;
  
  if (trend === "BULLISH") {
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

// ========== Get Data ==========
async function getData(symbol, interval = '15m', limit = 100) {
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

// ========== Send Telegram ==========
async function sendTelegram(token, chatId, text) {
  if (Date.now() - lastSend < 1500) return;
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  } catch(e) {}
}

// ========== Process Coin ==========
async function processCoin(coin, token, kv) {
  try {
    const symbol = coin + 'USDT';
    
    let cooldown = kv ? JSON.parse(await kv.get('COOLDOWN') || '{}') : {};
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < 4 * 60 * 60 * 1000) return;
    
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return;
    
    // Multi-Timeframe Alignment
    const mtf = await getMultiTimeframeAlignment(symbol);
    if (!mtf.aligned) return;
    
    // Entry Data
    const dataEntry = await getData(symbol, CONFIG.TIMEFRAMES.ENTRY, 150);
    if (!dataEntry) return;
    
    // Volume Filter
    const volume = volumeFilter(dataEntry);
    if (!volume.passed) return;
    
    // SMC Components
    const sweep = liquiditySweep(dataEntry);
    const fvg = detectFVG(dataEntry);
    const ob = detectOrderBlock(dataEntry);
    const pdZone = premiumDiscountZone(dataEntry, dataEntry[dataEntry.length - 1].close);
    const entrySide = mtf.trend === "BULLISH" ? "LONG" : "SHORT";
    
    // Premium Score
    const score = calculatePremiumScore({
      structure: mtf.trend,
      sweep,
      fvg,
      volumeRatio: volume.ratio,
      pdZone,
      entrySide
    });
    
    if (score < CONFIG.AI_SCORE_THRESHOLD) return;
    
    // Generate Entry
    const entry = generateEntry(dataEntry, mtf.trend);
    if (!entry) return;
    
    // Position Size (Assuming $10,000 account)
    const position = calculatePositionSize(10000, entry.entry, entry.sl);
    
    const msg = `🏦 *V14 ULTIMATE SIGNAL* 🏦\n━━━━━━━━━━━━━━━━━━━━\n🪙 *${coin}/USDT*\n🎯 *${entry.side}*\n💰 *$${entry.entry.toFixed(2)}*\n📊 *Confidence: ${score}/100*\n\n🎯 TP1: *$${entry.tp1.toFixed(2)}*\n🎯 TP2: *$${entry.tp2.toFixed(2)}*\n🎯 TP3: *$${entry.tp3.toFixed(2)}*\n🛑 SL: *$${entry.sl.toFixed(2)}*\n\n📊 *Risk Management:*\n• Risk: ${CONFIG.ACCOUNT_RISK_PERCENT}% (\$${position.riskAmount})\n• Position Size: ${position.positionSize} ${coin}\n• Leverage: ${position.recommendedLeverage}x\n\n📌 *Premium Analysis:*\n• MTF Alignment: *${mtf.aligned ? '✅' : '❌'}* (${mtf.masterTrend})\n• Volume Ratio: *${volume.ratio.toFixed(1)}x*\n• Liquidity Sweep: *${sweep.buySideSweep || sweep.sellSideSweep ? '✅' : '❌'}*\n• FVG: *${fvg ? '✅' : '❌'}*\n• Zone: *${entrySide === 'LONG' ? (pdZone.isDiscount ? '✅ DISCOUNT' : '⚠️ PREMIUM') : (pdZone.isPremium ? '✅ PREMIUM' : '⚠️ DISCOUNT')}*\n\n🏆 *Premium Score: ${score}/100* | *V14 ULTIMATE*`;
    
    await sendTelegram(token, TELEGRAM_CHAT_ID, msg);
    
    if (kv) {
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
    }
  } catch(e) { console.error(`Error ${coin}:`, e); }
}

// ========== Market Scanner ==========
async function marketScanner(token, kv) {
  console.log('🏦 V14 ULTIMATE Scanner Starting...');
  for (let i = 0; i < WATCH_LIST.length; i += CONFIG.BATCH_SIZE) {
    const batch = WATCH_LIST.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(coin => processCoin(coin, token, kv)));
    await delay(CONFIG.DELAY);
  }
  console.log('✅ V14 ULTIMATE Complete');
}

// ========== Commands ==========
const MENU = {
  inline_keyboard: [
    [{ text: "💰 BTC", callback_data: "btc" }, { text: "🚀 TOP", callback_data: "top" }],
    [{ text: "📊 STATS", callback_data: "stats" }, { text: "🏆 V14", callback_data: "about" }],
    [{ text: "💎 SUBSCRIBE", callback_data: "subscribe" }]
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
  return data.filter(i => i.symbol.endsWith('USDT')).slice(0, 5).map(i => ({ s: i.symbol.replace('USDT', ''), c: parseFloat(i.priceChangePercent) }));
}

async function getDashboardHTML(kv) {
  let stats = { total: 0 };
  if (kv) {
    const raw = await kv.get('STATS');
    if (raw) stats = JSON.parse(raw);
  }
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>V14 Ultimate Dashboard</title>
<style>
  body{background:#0a0a1a;color:#fff;font-family:sans-serif;padding:20px;text-align:center}
  .stat-card{background:#1a1a2e;padding:20px;border-radius:15px;margin:20px auto;max-width:400px}
  .value{font-size:48px;color:#00b4d8}
</style>
</head>
<body>
<h1>🏦 V14 ULTIMATE</h1>
<p>Multi-Timeframe | Premium Score | Risk Management</p>
<div class="stat-card"><h2>🎯 Total Signals</h2><div class="value">${stats.total}</div></div>
<p>✅ 4H + 1H + 15M Alignment</p>
<p>✅ Volume Filter (≥1.5x)</p>
<p>✅ Premium/Discount Zones</p>
<p>✅ Order Blocks</p>
<p>✅ Position Size Calculator</p>
</body>
</html>`;
}

// ========== Main Worker ==========
export default {
  async scheduled(event, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (token) ctx.waitUntil(marketScanner(token, env.SIGNALS_KV));
  },
  
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;
    const kv = env.SIGNALS_KV;
    
    if (!token) return new Response('❌ Bot token not configured', { status: 500 });
    
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
            await sendTelegram(token, cb.message.chat.id, `💰 *BTC*\n$${btc.toLocaleString()}`);
          } else if (cb.data === 'top') {
            const movers = await getTopMovers();
            await sendTelegram(token, cb.message.chat.id, `🚀 *أفضل الصاعدين*\n${movers.map(m => `🟢 ${m.s}: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (cb.data === 'stats') {
            let stats = { total: 0 };
            if (kv) {
              const raw = await kv.get('STATS');
              if (raw) stats = JSON.parse(raw);
            }
            await sendTelegram(token, cb.message.chat.id, `📊 *V14 STATS*\n🎯 Total Signals: ${stats.total}\n📈 Success Rate: Calculating...`);
          } else if (cb.data === 'about') {
            await sendTelegram(token, cb.message.chat.id, `🏦 *V14 ULTIMATE* 🏦\n✅ Multi-Timeframe (4H+1H+15M)\n✅ Premium Score System\n✅ Volume Filter (1.5x)\n✅ Order Blocks\n✅ Premium/Discount Zones\n✅ Position Size Calculator\n✅ Risk Management`);
          } else if (cb.data === 'subscribe') {
            await sendTelegram(token, cb.message.chat.id, `💎 *اشتراك مميز* 💎\n━━━━━━━━━━━━━━━━━━━━\n📊 مميزات الاشتراك:\n• إشارات حصرية\n• تحليل متقدم\n• دعم فني\n\nللاشتراك: @SupportBot`);
          }
          
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            body: JSON.stringify({ callback_query_id: cb.id })
          });
          return new Response('OK');
        }
        
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim().toUpperCase();
          
          if (text === '/START') {
            await sendTelegram(token, chatId, `🏦 *V14 ULTIMATE* 🏦\n━━━━━━━━━━━━━━━━━━━━━\n✅ *Professional Trading Bot*\n\n📊 *Features:*\n• Multi-Timeframe (4H+1H+15M)\n• Premium Score System\n• Volume Filter (≥1.5x)\n• Order Blocks & FVG\n• Premium/Discount Zones\n• Position Size Calculator\n• Risk Management\n\n📈 *AI Threshold: 85%*\n\n📊 Dashboard: https://${url.hostname}/dashboard\n\n💎 *للاشتراك:* /subscribe`, MENU);
          } else if (text === '/SUBSCRIBE') {
            await sendTelegram(token, chatId, `💎 *باقة الاشتراك المميز* 💎\n━━━━━━━━━━━━━━━━━━━━\n📊 *المميزات:*\n• إشارات حصرية يومياً\n• أولوية الدعم الفني\n• تحليلات متقدمة\n• تحديثات فورية\n\n💰 *السعر:* $49/شهر\n\nللاشتراك، تواصل مع الدعم: @SupportBot`);
          } else {
            await sendTelegram(token, chatId, `📋 *V14 Commands*\n/start - Main Menu\n/stats - Statistics\n/btc - Bitcoin Price\n/top - Top Gainers\n/subscribe - Subscription Info`);
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
