// ============================================================
// TRADING AI PRO V16.1 - THE ULTIMATE QUANT MASTER (FIXED)
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059';
const CHANNEL_INVITE_LINK = 'https://t.me/mr_crypto16';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 25,
  MIN_VOLUME_USD: 1000000,
  COOLDOWN_HOURS: 1,
  BATCH_SIZE: 4,
  DELAY: 800,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  ACCOUNT_RISK_PERCENT: 1.0,
  CACHE_TTL_MS: 15000,
  AI_SCORE_THRESHOLD: 80,
  VOLUME_RATIO_THRESHOLD: 1.3,
  TIMEFRAMES: {
    MASTER: '1h',
    CONFIRM: '15m',
    ENTRY: '5m'
  },
  SIGNAL_TIERS: {
    DIAMOND: { minScore: 95, emoji: '💎', name: 'DIAMOND', description: 'فرصة نادرة جداً - تركيز عالي' },
    GOLD: { minScore: 85, emoji: '🥇', name: 'GOLD', description: 'فرصة قوية جداً - ثقة عالية' },
    SILVER: { minScore: 75, emoji: '🥈', name: 'SILVER', description: 'فرصة جيدة - إيجابية' }
  },
  RISK_LEVELS: {
    LOW: 0.5,
    MEDIUM: 1.0,
    HIGH: 2.0
  }
};

const CATEGORIES = {
  MAJOR: [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON',
    'MATIC', 'ATOM', 'UNI', 'AAVE', 'MKR', 'LTC', 'BCH'
  ],
  ALPHA: [
    'SUI', 'NEAR', 'APT', 'FET', 'RNDR', 'OP', 'ARB', 'IMX', 'STX', 'SEI',
    'TIA', 'INJ', 'JUP', 'PYTH', 'TAO', 'WLD'
  ],
  MEME: [
    'DOGE', 'PEPE', 'WIF', 'FLOKI', 'BONK', 'SHIB', 'BRETT', 'BOME', 'MEW',
    'POPCAT', 'MOODENG', 'NEIRO', 'TURBO', 'MYRO'
  ]
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();
let activeSignalsInSession = new Set();

// ========== محرك التتبع المباشر للأرباح المعدل ليعتمد على KV ==========
async function trackOpenTrade(tradeId, tradeData, env) {
  if (!env?.SIGNALS_KV) return;
  const kv = env.SIGNALS_KV;
  let trades = JSON.parse(await kv.get('OPEN_TRADES') || '{}');
  
  trades[tradeId] = {
    ...tradeData,
    openedAt: Date.now(),
    status: 'OPEN',
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    stopLossHit: false
  };
  
  await kv.put('OPEN_TRADES', JSON.stringify(trades));
}

async function updateAllTrades(env) {
  if (!env?.SIGNALS_KV) return;
  const kv = env.SIGNALS_KV;
  let trades = JSON.parse(await kv.get('OPEN_TRADES') || '{}');
  let history = JSON.parse(await kv.get('TRADE_HISTORY') || '[]');
  let perfStats = JSON.parse(await kv.get('PERFORMANCE_STATS') || '{"totalSignals":0,"wins":0,"losses":0,"totalProfit":0}');
  
  let updatedTrades = { ...trades };
  let hasChanges = false;

  for (const tradeId in trades) {
    const trade = trades[tradeId];
    if (trade.status !== 'OPEN') continue;

    const currentPrice = await getLivePrice(trade.coin);
    if (!currentPrice) continue;

    const isLong = trade.side === 'LONG';
    const lev = trade.leverage || 1;
    let updates = {};

    // فحص TP1
    if (!trade.tp1Hit && (isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1)) {
      updates.tp1Hit = true;
      hasChanges = true;
      const profit = ((Math.abs(currentPrice - trade.entry) / trade.entry) * 100 * lev).toFixed(2);
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, 
        `✅ *mr_crypto16_bot | TP1 HIT* ✅\n━━━━━━━━━━━━━━━━━━━━\n🪙 العملة: ${trade.coin}/USDT\n💰 ربح الرافعة (${lev}x): +${profit}%\n🛡️ الصفقة الآن آمنة، يرجى نقل الستوب لوز لنقطة الدخول!`);
    }

    // فحص TP2
    if (!trade.tp2Hit && (isLong ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2)) {
      updates.tp2Hit = true;
      hasChanges = true;
      const profit = ((Math.abs(currentPrice - trade.entry) / trade.entry) * 100 * lev).toFixed(2);
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, 
        `🎯 *mr_crypto16_bot | TP2 HIT* 🎯\n━━━━━━━━━━━━━━━━━━━━\n🪙 العملة: ${trade.coin}/USDT\n💰 ربح الرافعة (${lev}x): +${profit}%`);
    }

    // فحص TP3
    if (!trade.tp3Hit && (isLong ? currentPrice >= trade.tp3 : currentPrice <= trade.tp3)) {
      updates.status = 'CLOSED_WIN';
      hasChanges = true;
      const finalProfit = ((Math.abs(currentPrice - trade.entry) / trade.entry) * 100 * lev);
      
      perfStats.wins++;
      perfStats.totalProfit += finalProfit;
      
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, 
        `🏆 *mr_crypto16_bot | FULL TAKE PROFIT* 🏆\n━━━━━━━━━━━━━━━━━━━━\n🪙 العملة: ${trade.coin}/USDT\n💰 إجمالي ربح الرافعة: +${finalProfit.toFixed(2)}%\n✅ تم قفل الصفقة بنجاح كامل!`);
    }

    // فحص Stop Loss
    if (!updates.status && !trade.stopLossHit && (isLong ? currentPrice <= trade.sl : currentPrice >= trade.sl)) {
      updates.status = 'CLOSED_LOSS';
      hasChanges = true;
      const finalLoss = -((Math.abs(currentPrice - trade.entry) / trade.entry) * 100 * lev);
      
      perfStats.losses += finalLoss;
      
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, 
        `🔴 *mr_crypto16_bot | STOP LOSS HIT* 🔴\n━━━━━━━━━━━━━━━━━━━━\n🪙 العملة: ${trade.coin}/USDT\n📉 خسارة الرافعة: ${finalLoss.toFixed(2)}%\n💡 صفقة معوضة قادمة قريباً بإذن الله!`);
    }

    if (hasChanges) {
      Object.assign(trade, updates);
      if (trade.status === 'CLOSED_WIN' || trade.status === 'CLOSED_LOSS') {
        trade.closedAt = Date.now();
        history.unshift(trade);
        if (history.length > 200) history.pop();
        delete updatedTrades[tradeId];
      } else {
        updatedTrades[tradeId] = trade;
      }
    }
  }

  if (hasChanges) {
    await kv.put('OPEN_TRADES', JSON.stringify(updatedTrades));
    await kv.put('TRADE_HISTORY', JSON.stringify(history));
    await kv.put('PERFORMANCE_STATS', JSON.stringify(perfStats));
  }
}

// ========== Correlation Filter ==========
function calculateCorrelation(prices1, prices2) {
  if (prices1.length !== prices2.length || prices1.length < 10) return 0;
  const n = prices1.length;
  const sum1 = prices1.reduce((a,b) => a + b, 0);
  const sum2 = prices2.reduce((a,b) => a + b, 0);
  const sum1Sq = prices1.reduce((a,b) => a + b * b, 0);
  const sum2Sq = prices2.reduce((a,b) => a + b * b, 0);
  const sum12 = prices1.reduce((a,b,i) => a + b * prices2[i], 0);
  const numerator = n * sum12 - sum1 * sum2;
  const denominator = Math.sqrt((n * sum1Sq - sum1 * sum1) * (n * sum2Sq - sum2 * sum2));
  return denominator === 0 ? 0 : numerator / denominator;
}

async function checkCorrelation(coin) {
  const correlatedPairs = {
    'BTC': ['ETH', 'SOL'],
    'ETH': ['BTC', 'SOL'],
    'SOL': ['BTC', 'ETH']
  };
  const correlated = correlatedPairs[coin] || [];
  let activeCorrelated = 0;
  for (const corrCoin of correlated) {
    if (activeSignalsInSession.has(corrCoin + 'USDT')) activeCorrelated++;
  }
  return activeCorrelated < 2; 
}

// ========== Liquidity Grab Detection ==========
function detectLiquidityGrab(data) {
  if (data.length < 15) return { detected: false, type: null };
  const last5 = data.slice(-5);
  const prev5 = data.slice(-10, -5);
  let grabDetected = false;
  let grabType = null;
  
  for (let i = 0; i < last5.length; i++) {
    const maxPrevHigh = Math.max(...prev5.map(d => d.high));
    const minPrevLow = Math.min(...prev5.map(d => d.low));
    if (last5[i].high > maxPrevHigh && last5[i].close < maxPrevHigh) {
      grabDetected = true;
      grabType = 'LIQUIDITY_GRAB_BULLISH';
    }
    if (last5[i].low < minPrevLow && last5[i].close > minPrevLow) {
      grabDetected = true;
      grabType = 'LIQUIDITY_GRAB_BEARISH';
    }
  }
  return { detected: grabDetected, type: grabType };
}

function getSignalTier(score) {
  if (score >= CONFIG.SIGNAL_TIERS.DIAMOND.minScore) return CONFIG.SIGNAL_TIERS.DIAMOND;
  if (score >= CONFIG.SIGNAL_TIERS.GOLD.minScore) return CONFIG.SIGNAL_TIERS.GOLD;
  return CONFIG.SIGNAL_TIERS.SILVER;
}

async function getPerformanceMetrics(kv) {
  let stats = { totalSignals: 0, wins: 0, losses: 0, totalProfit: 0 };
  if (kv) {
    const raw = await kv.get('PERFORMANCE_STATS');
    if (raw) stats = JSON.parse(raw);
    const dayStats = JSON.parse(await kv.get('STATS') || '{"total":0}');
    stats.totalSignals = dayStats.total || stats.totalSignals;
  }
  const winRate = stats.totalSignals > 0 ? (stats.wins / stats.totalSignals) * 100 : 0;
  const profitFactor = stats.losses !== 0 ? stats.totalProfit / Math.abs(stats.losses) : stats.totalProfit;
  return { ...stats, winRate, profitFactor };
}

// ========== المؤشرات الفنية ==========
function ema(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let e = data[0];
  for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}

function calculateATR(data, period = 14) {
  if (data.length < period + 1) return null;
  const recentData = data.slice(-(period + 15)); 
  const trueRanges = [];
  for (let i = 1; i < recentData.length; i++) {
    const tr = Math.max(
      recentData[i].high - recentData[i].low, 
      Math.abs(recentData[i].high - recentData[i-1].close), 
      Math.abs(recentData[i].low - recentData[i-1].close)
    );
    trueRanges.push(tr);
  }
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) atr = (atr * (period - 1) + trueRanges[i]) / period;
  return atr;
}

async function getMultiTimeframeAlignment(symbol) {
  const dataMaster = await getData(symbol, CONFIG.TIMEFRAMES.MASTER, 100);
  const dataConfirm = await getData(symbol, CONFIG.TIMEFRAMES.CONFIRM, 100);
  if (!dataMaster || !dataConfirm) return { aligned: false, trend: 'NEUTRAL' };
  
  const ema20Master = ema(dataMaster.map(d => d.close), 20);
  const ema50Master = ema(dataMaster.map(d => d.close), 50);
  const ema20Confirm = ema(dataConfirm.map(d => d.close), 20);
  const ema50Confirm = ema(dataConfirm.map(d => d.close), 50);
  
  const masterTrend = ema20Master > ema50Master ? 'BULLISH' : 'BEARISH';
  const confirmTrend = ema20Confirm > ema50Confirm ? 'BULLISH' : 'BEARISH';
  
  return { aligned: masterTrend === confirmTrend, trend: masterTrend };
}

function volumeFilter(data) {
  const lastVol = data[data.length - 1].vol;
  const avgVol = data.slice(-20).reduce((a, b) => a + b.vol, 0) / 20;
  return { passed: (lastVol / avgVol) >= CONFIG.VOLUME_RATIO_THRESHOLD, ratio: lastVol / avgVol };
}

function liquiditySweep(data) {
  const last = data[data.length - 1];
  const lookback = Math.min(30, data.length - 5);
  const maxHigh = Math.max(...data.slice(-lookback, -1).map(d => d.high));
  const minLow = Math.min(...data.slice(-lookback, -1).map(d => d.low));
  return { buySideSweep: last.high > maxHigh && last.close < maxHigh, sellSideSweep: last.low < minLow && last.close > minLow };
}

function detectOrderBlock(data) {
  if (data.length < 5) return { bullish: false, bearish: false };
  const prev = data[data.length - 2];
  const curr = data[data.length - 1];
  return {
    bullish: prev.close < prev.open && curr.close > curr.open && curr.close > prev.high,
    bearish: prev.close > prev.open && curr.close < curr.open && curr.close < prev.low
  };
}

function premiumDiscountZone(data, currentPrice) {
  const highs = data.slice(-20).map(d => d.high);
  const lows = data.slice(-20).map(d => d.low);
  const range = Math.max(...highs) - Math.min(...lows);
  return { isDiscount: currentPrice <= (Math.min(...lows) + range * 0.382), isPremium: currentPrice >= (Math.max(...highs) - range * 0.382) };
}

function detectFVG(data) {
  if (data.length < 5) return null;
  const i = data.length - 1;
  if (data[i-2].high < data[i].low) return "BULLISH_FVG";
  if (data[i-2].low > data[i].high) return "BEARISH_FVG";
  return null;
}

function calculatePremiumScore({ structure, sweep, fvg, volumeRatio, pdZone, entrySide, ob, liquidityGrab }) {
  let score = 20;
  if (structure === (entrySide === 'LONG' ? "BULLISH" : "BEARISH")) score += 30;
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 20;
  if (volumeRatio >= 1.3) score += 15;
  if (fvg) score += 10;
  if ((entrySide === 'LONG' && ob.bullish) || (entrySide === 'SHORT' && ob.bearish)) score += 5;
  if (liquidityGrab.detected) score += 10;
  return Math.min(score, 100);
}

function calculatePositionSize(accountBalance, entryPrice, stopLoss, riskLevel = 'MEDIUM') {
  const riskPercent = CONFIG.RISK_LEVELS[riskLevel] || CONFIG.RISK_LEVELS.MEDIUM;
  const riskAmount = accountBalance * (riskPercent / 100);
  const priceDifference = Math.abs(entryPrice - stopLoss);
  if (priceDifference === 0) return { positionSize: "0", dollarValue: "0", riskAmount: "0", recommendedLeverage: 1 };
  
  const positionSize = riskAmount / priceDifference;
  let recommendedLeverage = Math.floor((positionSize * entryPrice) / accountBalance);
  if (recommendedLeverage < 1) recommendedLeverage = 1;
  if (recommendedLeverage > 10) recommendedLeverage = 10; 
  
  return { positionSize: positionSize.toFixed(3), dollarValue: (positionSize * entryPrice).toFixed(2), riskAmount: riskAmount.toFixed(2), recommendedLeverage };
}

async function getData(symbol, interval = '15m', limit = 100) {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  if (dataCache.has(cacheKey) && (Date.now() - dataCache.get(cacheKey).timestamp < CONFIG.CACHE_TTL_MS)) return dataCache.get(cacheKey).data;
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json();
    const formatted = data.map(c => ({ open: +c[1], high: +c[2], low: +c[3], close: +c[4], vol: +c[5] }));
    dataCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
    return formatted;
  } catch { return null; }
}

async function checkChannelSubscription(token, userId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${TELEGRAM_CHAT_ID}&user_id=${userId}`);
    if (!res.ok) return false;
    const data = await res.json();
    return ['creator', 'administrator', 'member'].includes(data.result?.status);
  } catch (e) { return false; }
}

function formatPrice(price, coin) {
  if (!price) return "0.00";
  if (price < 0.001) return price.toFixed(7);
  if (price < 1.0) return price.toFixed(5);
  return price.toFixed(2);
}

async function sendTelegram(token, chatId, text, keyboard = null) {
  if (Date.now() - lastSend < CONFIG.ANTI_SPAM_MS) await delay(CONFIG.ANTI_SPAM_MS);
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch(e) {}
}

async function processCoin(coin, token, kv) {
  try {
    const symbol = coin + 'USDT';
    if (activeSignalsInSession.has(symbol)) return null;

    let cooldown = kv ? JSON.parse(await kv.get('COOLDOWN') || '{}') : {};
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < CONFIG.COOLDOWN_HOURS * 60 * 60 * 1000) return null;
    
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return null;

    const correlationOk = await checkCorrelation(coin);
    if (!correlationOk) return null;

    const mtf = await getMultiTimeframeAlignment(symbol);
    if (!mtf.aligned) return null;

    const dataEntry = await getData(symbol, CONFIG.TIMEFRAMES.ENTRY, 150);
    if (!dataEntry) return null;

    const volume = volumeFilter(dataEntry);
    if (!volume.passed) return null;

    const sweep = liquiditySweep(dataEntry);
    const fvg = detectFVG(dataEntry);
    const ob = detectOrderBlock(dataEntry);
    const pdZone = premiumDiscountZone(dataEntry, dataEntry[dataEntry.length - 1].close);
    const entrySide = mtf.trend === "BULLISH" ? "LONG" : "SHORT";
    const liquidityGrab = detectLiquidityGrab(dataEntry);

    const score = calculatePremiumScore({ structure: mtf.trend, sweep, fvg, volumeRatio: volume.ratio, pdZone, entrySide, ob, liquidityGrab });
    if (score < CONFIG.AI_SCORE_THRESHOLD) return null;

    const last = dataEntry[dataEntry.length - 1];
    const atr = calculateATR(dataEntry);
    if (!atr) return null;

    const isLong = mtf.trend === "BULLISH";
    const entryPrice1 = last.close;
    const entryPrice2 = isLong ? entryPrice1 * 0.997 : entryPrice1 * 1.003;

    const sl = isLong ? entryPrice1 - (atr * 1.2) : entryPrice1 + (atr * 1.2);
    const tp1 = isLong ? entryPrice1 + atr * 1.2 : entryPrice1 - atr * 1.2;
    const tp2 = isLong ? entryPrice1 + atr * 2.2 : entryPrice1 - atr * 2.2;
    const tp3 = isLong ? entryPrice1 + atr * 3.5 : entryPrice1 - atr * 3.5;

    const position = calculatePositionSize(10000, entryPrice1, sl);
    const tier = getSignalTier(score);

    let category = 'MAJOR';
    if (CATEGORIES.ALPHA.includes(coin)) category = 'ALPHA 🚀';
    if (CATEGORIES.MEME.includes(coin)) category = 'MEME 🐶';

    const tradeId = `${symbol}_${Date.now()}`;
    await trackOpenTrade(tradeId, {
      coin, side: isLong ? 'LONG' : 'SHORT', entry: entryPrice1, tp1, tp2, tp3, sl,
      score, tier: tier.name, leverage: position.recommendedLeverage
    }, { SIGNALS_KV: kv });

    const msg = `${tier.emoji} *${tier.name} SIGNAL* ${tier.emoji}
━━━━━━━━━━━━━━━━━━━━
📊 *القسم:* ${category}
🪙 *العملة:* ${coin}/USDT
🎯 *التوجيه:* ${isLong ? 'LONG 📈' : 'SHORT 📉'}
⚖️ *الرافعة:* \`${position.recommendedLeverage}x\`
📊 *قوة الصفقة:* \`${score}/100\` (${tier.description})

🧱 *مناطق الدخول:* • الدخول 1: \`$${formatPrice(entryPrice1, coin)}\`
• الدخول 2: \`$${formatPrice(entryPrice2, coin)}\`

🎯 *الأهداف:*
• TP1: \`$${formatPrice(tp1, coin)}\`
• TP2: \`$${formatPrice(tp2, coin)}\`
• TP3: \`$${formatPrice(tp3, coin)}\`

🛑 *Stop Loss:* \`$${formatPrice(sl, coin)}\`

⚙️ *إدارة رأس المال:* ريسك 1% | حجم: ${position.positionSize} ${coin}

🛡 *ملاحظة:* بمجرد ضرب TP1، انقل الستوب إلى الدخول

🏆 *V16 QUANT MASTER - mr_crypto16_bot*`;

    await sendTelegram(token, TELEGRAM_CHAT_ID, msg);
    activeSignalsInSession.add(symbol);

    if (kv) {
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
      let stats = JSON.parse(await kv.get('STATS') || '{"total":0}');
      stats.total += 1;
      await kv.put('STATS', JSON.stringify(stats));
    }
    return true;
  } catch(e) { return null; }
}

async function marketScanner(token, kv, enforcedCategory = null) {
  let categoryToScan = enforcedCategory;
  if (!categoryToScan && kv) {
    const lastCategory = await kv.get('LAST_SCANNED_CATEGORY') || 'MAJOR';
    if (lastCategory === 'MAJOR') categoryToScan = 'ALPHA';
    else if (lastCategory === 'ALPHA') categoryToScan = 'MEME';
    else categoryToScan = 'MAJOR';
    await kv.put('LAST_SCANNED_CATEGORY', categoryToScan);
  }
  if (!categoryToScan) categoryToScan = 'MAJOR';
  const watchList = CATEGORIES[categoryToScan];
  if (!watchList || watchList.length === 0) return;
  
  activeSignalsInSession.clear();
  
  // تحديث الصفقات من الـ KV مباشرة لمنع مسح الذاكرة
  await updateAllTrades({ TELEGRAM_BOT_TOKEN: token, SIGNALS_KV: kv });
  
  for (let i = 0; i < watchList.length; i += CONFIG.BATCH_SIZE) {
    const batch = watchList.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(coin => processCoin(coin, token, kv)));
    await delay(CONFIG.DELAY);
  }
}

async function getLivePrice(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}USDT`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch { return null; }
}

async function getTopMovers() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const data = await res.json();
    return data
      .filter(i => i.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 5)
      .map(i => ({ s: i.symbol.replace('USDT', ''), c: parseFloat(i.priceChangePercent) }));
  } catch { return []; }
}

async function getCryptoFearAndGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    const data = await res.json();
    return `${data.data[0].value} (${data.data[0].value_classification})`;
  } catch { return "غير متوفر حالياً"; }
}

const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: "💰 سعر BTC", callback_data: "cmd_btc" }, { text: "💎 سعر ETH", callback_data: "cmd_eth" }],
    [{ text: "🔥 أفضل 5 صعوداً", callback_data: "cmd_top" }, { text: "📊 الخوف والطمع", callback_data: "cmd_fear" }],
    [{ text: "📈 إحصائيات الأداء", callback_data: "cmd_stats" }, { text: "📊 Backtest", callback_data: "cmd_backtest" }],
    [{ text: "📋 الصفقات المفتوحة", callback_data: "cmd_open_trades" }, { text: "🏆 إنجازات V16", callback_data: "cmd_about" }]
  ]
};

function getSubscribeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📢 انضم لقناة الصفقات", url: CHANNEL_INVITE_LINK }],
      [{ text: "✅ تم الانضمام (تفعيل)", callback_data: "check_sub" }]
    ]
  };
}

export default {
  async scheduled(event, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const kv = env.SIGNALS_KV;
    if (token) ctx.waitUntil(marketScanner(token, kv, null));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;
    const kv = env.SIGNALS_KV;

    if (!token) return new Response('❌ Bot token not configured', { status: 500 });

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      const metrics = await getPerformanceMetrics(kv);
      return new Response(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>V16 QUANT MASTER Dashboard</title>
<style>
  body{background:#0a0a1a;color:#fff;font-family:'Segoe UI',sans-serif;padding:20px;text-align:center}
  h1{background:linear-gradient(135deg,#ffd700,#ff8c00);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .card{background:rgba(255,255,255,0.1);border-radius:15px;padding:20px;margin:20px auto;max-width:600px}
  .value{font-size:48px;color:#ffd700}
  .metric{display:inline-block;margin:10px;padding:15px;background:rgba(255,255,255,0.05);border-radius:10px;min-width:150px}
  .win{color:#00ff88}
</style>
</head>
<body>
<h1>🏦 TRADING AI PRO V16</h1>
<p>ULTIMATE QUANT MASTER | 5M Scalping | AI-Powered</p>
<div class="card">
  <h2>📊 Performance Dashboard</h2>
  <div class="metric"><div>Total Signals</div><div class="value">${metrics.totalSignals || 0}</div></div>
  <div class="metric"><div>Win Rate</div><div class="value win">${metrics.winRate?.toFixed(1) || 0}%</div></div>
  <div class="metric"><div>Profit Factor</div><div class="value">${metrics.profitFactor?.toFixed(2) || 0}</div></div>
</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.callback_query) {
          const cb = update.callback_query;
          const userId = cb.from.id;
          const chatId = cb.message.chat.id;
          const data = cb.data;

          if (data === "check_sub") {
            const isSubbed = await checkChannelSubscription(token, userId);
            if (isSubbed) {
              await sendTelegram(token, chatId, `🎉 *V16 QUANT MASTER ACTIVATED* 🎉\n━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ نظام الذكاء الاصطناعي يعمل\n✅ تتبع الأرباح والخسائر مباشر\n✅ تصنيف الإشارات (💎🥇🥈)\n\nاستخدم القائمة:`, MENU_KEYBOARD);
            } else {
              await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                body: JSON.stringify({ callback_query_id: cb.id, text: "❌ اشترك أولاً بالقناة لتفعيل المحرك!", show_alert: true })
              });
            }
            return new Response('OK');
          }

          const isSubbed = await checkChannelSubscription(token, userId);
          if (!isSubbed) return new Response('OK');

          if (data === 'cmd_btc') {
            const p = await getLivePrice('BTC');
            await sendTelegram(token, chatId, `💰 *BTC/USDT:* \`$${p?.toLocaleString()}\``);
          } else if (data === 'cmd_eth') {
            const p = await getLivePrice('ETH');
            await sendTelegram(token, chatId, `💎 *ETH/USDT:* \`$${p?.toLocaleString()}\``);
          } else if (data === 'cmd_top') {
            const movers = await getTopMovers();
            await sendTelegram(token, chatId, `🔥 *أفضل الصاعدين:*\n${movers.map(m => `🟢 *${m.s}*: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (data === 'cmd_fear') {
            const fng = await getCryptoFearAndGreed();
            await sendTelegram(token, chatId, `📊 *الخوف والطمع:* \`${fng}\``);
          } else if (data === 'cmd_stats') {
            const metrics = await getPerformanceMetrics(kv);
            await sendTelegram(token, chatId, `📊 *V16 Performance*\n━━━━━━━━━━━━━━━━━━━━\n📈 إجمالي الإشارات: ${metrics.totalSignals}\n✅ نسبة النجاح: ${metrics.winRate?.toFixed(1) || 0}%\n💰 Profit Factor: ${metrics.profitFactor?.toFixed(2) || 0}`);
          } else if (data === 'cmd_open_trades') {
            let trades = JSON.parse(await kv?.get('OPEN_TRADES') || '{}');
            const size = Object.keys(trades).length;
            if (size === 0) {
              await sendTelegram(token, chatId, `📭 *لا توجد صفقات مفتوحة حالياً تحت التتبع.*`);
            } else {
              let msg = `📋 *الصفقات المفتوحة لـ mr_crypto16_bot (${size})*\n━━━━━━━━━━━━━━━━━━━━\n`;
              for (const id in trades) {
                const t = trades[id];
                msg += `🪙 *${t.coin}* | ${t.side} (${t.tier})\n💰 دخول: $${t.entry?.toFixed(4)}\n🎯 TP1: $${t.tp1?.toFixed(4)} ${t.tp1Hit ? '✅' : '⏳'}\n🎯 TP2: $${t.tp2?.toFixed(4)} ${t.tp2Hit ? '✅' : '⏳'}\n🎯 TP3: $${t.tp3?.toFixed(4)} ${t.tp3Hit ? '✅' : '⏳'}\n🛑 SL: $${t.sl?.toFixed(4)}\n━━━━━━━━━━━━━━━━━━━━\n`;
              }
              await sendTelegram(token, chatId, msg);
            }
          } else if (data === 'cmd_backtest') {
            await sendTelegram(token, chatId, `📊 *Backtesting Engine*\n━━━━━━━━━━━━━━━━━━━━\n🔧 يتطلب تحليل البيانات التاريخية موارد معالجة منفصلة. يرجى مراجعة التقارير الأسبوعية المثبتة في القناة لتفادي إيقاف البوت مؤقتاً.`);
          } else if (data === 'cmd_about') {
            await sendTelegram(token, chatId, `🏆 *V16 QUANT MASTER* 🏆\n━━━━━━━━━━━━━━━━━━━━\n🆕 *الميزات الاستراتيجية:*\n• 💎 تصنيف الإشارات الذكي\n• 📈 تتبع الأرباح الفعلي بالـ KV\n• 🔗 فلتر الارتباط بين عمالقة السوق\n• 🎯 رصد قناص لضرب السيولة (Liquidity Grab)\n\n⚡ *سرعة القنص:* 5 دقائق\n🎯 *المطور الفني:* mr_crypto16_bot`);
          }

          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: 'POST', body: JSON.stringify({ callback_query_id: cb.id }) });
          return new Response('OK');
        }

        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const userId = update.message.from.id;
          const cmd = update.message.text.trim().toUpperCase();

          if (cmd === '/START' || cmd === '/MENU') {
            const isSubbed = await checkChannelSubscription(token, userId);
            if (!isSubbed) {
              await sendTelegram(token, chatId, `🔒 *V16 QUANT MASTER*\n━━━━━━━━━━━━━━━━━━━━━━━━━\n⚠️ للوصول إلى لوحة تحكم وإشارات محرك *mr_crypto16_bot*، اشترك في القناة الرسمية أولاً:`, getSubscribeKeyboard());
              return new Response('OK');
            }
            await sendTelegram(token, chatId, `🏦 *V16 QUANT MASTER - ACTIVE* 🏦\n━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ نظام متابعة الأرباح بالكامل\n✅ تصنيف صفقات الكريبتو (💎🥇🥈)\n✅ فلتر منع تكرار الأصول المرتبطة\n\nتفضل باختيار الأمر المناسب لخدمتك:`, MENU_KEYBOARD);
            return new Response('OK');
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
