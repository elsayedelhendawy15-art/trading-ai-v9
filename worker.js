// ============================================================
// 🏆 TRADING AI PRO V10.0 - INSTITUTIONAL ULTIMATE EDITION
// Smart Money Concept | ICT | Crypto Trading
// ============================================================

// ======================= 1. الإعدادات الأساسية =======================

const REQUIRED_CHANNEL = '@mrcrypto166';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 8,
  MIN_RISK_REWARD: 2.5,
  SCORE_STRONG: 95,
  SCORE_BUY: 88,
  SCORE_WATCH: 75,
  COOLDOWN_HOURS: 4,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 3.5],
  CACHE_TTL_MS: 300000,
  BATCH_SIZE: 2,
  DELAY: 1000,
  
  INSTITUTIONAL: {
    MIN_VOLUME_USD: 10000000,
    MIN_VOLUME_ALPHA: 3000000,
    MIN_OI_USD: 20000000,
    MIN_FUNDING_RATE: -0.0003,
    MAX_FUNDING_RATE: 0.0003,
    MIN_ORDER_BOOK_DEPTH: 1000000,
    MIN_TRADES_COUNT: 5000
  },
  
  SMC: {
    MIN_OB_STRENGTH: 2.0,
    MIN_FVG_SIZE_PIPS: 3,
    MIN_SWING_STRENGTH: 2,
    LIQUIDITY_SWEEP_TOLERANCE: 0.5,
    BOS_CONFIRMATION_CANDLES: 3,
    CHoCH_MIN_BODY_RATIO: 1.5,
    BREAKER_BLOCK_TOLERANCE: 0.003,
    MITIGATION_TOLERANCE: 0.002,
    CONSEQUENT_ENCROACHMENT: 0.5
  },
  
  VWAP: { PERIOD: 20, DEVIATION: 2.0 },
  VOLUME_PROFILE: { ROWS: 20, VALUE_AREA: 0.7 },
  
  RSI: {
    BULLISH_MIN: 45,
    BULLISH_MAX: 65,
    BEARISH_MIN: 35,
    BEARISH_MAX: 55,
    OVERSOLD: 30,
    OVERBOUGHT: 70,
    DIVERGENCE_LOOKBACK: 20
  },
  
  DAILY_BIAS: {
    WEIGHT_TREND: 0.25,
    WEIGHT_VOLUME: 0.15,
    WEIGHT_OI: 0.10,
    WEIGHT_FUNDING: 0.10,
    WEIGHT_BTC: 0.10,
    WEIGHT_DOMINANCE: 0.10,
    WEIGHT_PREMIUM_DISCOUNT: 0.10,
    WEIGHT_SESSION: 0.10
  },
  
  BTC_FILTER: {
    SHORT_PENALTY_WHEN_BULLISH: 25,
    LONG_PENALTY_WHEN_BEARISH: 25,
    BTC_DOMINANCE_THRESHOLD: 55
  },
  
  KILL_ZONES: {
    LONDON: { start: 7, end: 10 },
    NEW_YORK: { start: 13, end: 16 },
    ASIA: { start: 22, end: 2 }
  }
};

// ======================= 2. المتغيرات العامة =======================

let dataCache = new Map();
let fundingCache = new Map();
let oiCache = new Map();
let btcCache = null;
let btcCacheTime = 0;
let lastSend = 0;
let messageQueue = [];
let isProcessingQueue = false;

// ======================= 3. قوائم العملات =======================

const INSTITUTIONAL_WATCH_LIST = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP',
  'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC',
  'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR',
  'APT', 'SUI', 'ARB', 'OP', 'SEI',
  'INJ', 'RNDR', 'FET', 'AGIX', 'OCEAN',
  'DOGE', 'SHIB', 'PEPE', 'WIF', 'FLOKI'
];

const STABLE_COINS_BLACKLIST = [
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI',
  'BUSD', 'USDD', 'FRAX', 'LUSD', 'GUSD'
];

// ======================= 4. الأدوات المساعدة =======================

const delay = ms => new Promise(r => setTimeout(r, ms));

async function sendTelegram(chatId, text, keyboard = null) {
  const token = env?.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  
  messageQueue.push({ chatId, text, keyboard });
  processQueue();
}

async function sendTelegramImmediate(chatId, text, keyboard = null) {
  const token = env?.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    };
    if (keyboard) body.reply_markup = keyboard;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {}
}

async function processQueue() {
  const token = env?.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  
  if (isProcessingQueue || messageQueue.length === 0) return;
  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const { chatId, text, keyboard } = messageQueue.shift();
    const now = Date.now();
    if (now - lastSend >= CONFIG.ANTI_SPAM_MS) {
      await sendTelegramImmediate(chatId, text, keyboard);
      lastSend = now;
    } else {
      messageQueue.unshift({ chatId, text, keyboard });
      await delay(CONFIG.ANTI_SPAM_MS);
    }
  }
  isProcessingQueue = false;
}

// ======================= 5. المؤشرات المتقدمة =======================

class AdvancedIndicators {
  static wilderRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gain += diff;
      else loss -= diff;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return Math.round(100 - (100 / (1 + rs)));
  }

  static ema(data, period) {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let e = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  }

  static calculateATR(data, period = 14) {
    if (data.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < data.length; i++) {
      const tr = Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      );
      trueRanges.push(tr);
    }
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    return atr;
  }

  static calculateVWAP(data, period = 20) {
    if (data.length < period) return null;
    let cumVolume = 0;
    let cumPriceVolume = 0;
    const recent = data.slice(-period);
    for (const candle of recent) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumPriceVolume += typicalPrice * candle.vol;
      cumVolume += candle.vol;
    }
    return cumVolume > 0 ? cumPriceVolume / cumVolume : null;
  }

  static calculateVolumeProfile(data, rows = 20) {
    if (data.length < 50) return null;
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const range = maxPrice - minPrice;
    const rowSize = range / rows;
    
    const profile = {};
    for (const candle of data) {
      const row = Math.floor((candle.close - minPrice) / rowSize);
      const key = (minPrice + row * rowSize).toFixed(4);
      if (!profile[key]) profile[key] = 0;
      profile[key] += candle.vol;
    }
    
    const sorted = Object.entries(profile).sort((a, b) => b[1] - a[1]);
    const poc = parseFloat(sorted[0][0]);
    const totalVolume = Object.values(profile).reduce((a, b) => a + b, 0);
    let cumVolume = 0;
    let valueAreaHigh = poc;
    let valueAreaLow = poc;
    
    for (const [price, vol] of sorted) {
      cumVolume += vol;
      if (cumVolume / totalVolume < CONFIG.VOLUME_PROFILE.VALUE_AREA) {
        if (parseFloat(price) > valueAreaHigh) valueAreaHigh = parseFloat(price);
        if (parseFloat(price) < valueAreaLow) valueAreaLow = parseFloat(price);
      }
    }
    
    return { poc, valueAreaHigh, valueAreaLow, profile: sorted };
  }

  static calculateCVD(data) {
    if (data.length < 10) return null;
    let cvd = 0;
    const values = [];
    for (const candle of data) {
      const delta = candle.close > candle.open ? candle.vol : -candle.vol;
      cvd += delta;
      values.push(cvd);
    }
    return {
      current: cvd,
      trend: cvd > 0 ? 'BULLISH' : 'BEARISH',
      values,
      divergence: this.detectCVDDivergence(values, data.map(d => d.close))
    };
  }

  static detectCVDDivergence(cvdValues, prices) {
    if (cvdValues.length < 20) return null;
    const lastCVD = cvdValues[cvdValues.length - 1];
    const prevCVD = cvdValues[cvdValues.length - 5];
    const lastPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 5];
    
    if (lastPrice < prevPrice && lastCVD > prevCVD) {
      return { type: 'BULLISH', strength: 'STRONG' };
    }
    if (lastPrice > prevPrice && lastCVD < prevCVD) {
      return { type: 'BEARISH', strength: 'STRONG' };
    }
    return null;
  }
}

// ======================= 6. SMC المتقدم =======================

class AdvancedSMC {
  static detectLiquidity(data) {
    if (data.length < 50) return { sweeps: [], internal: null, external: null };
    
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const closes = data.map(d => d.close);
    
    const swingHighs = [];
    const swingLows = [];
    
    for (let i = 5; i < data.length - 5; i++) {
      let isHigh = true;
      let isLow = true;
      
      for (let j = i - 5; j <= i + 5; j++) {
        if (j === i) continue;
        if (highs[j] >= highs[i]) isHigh = false;
        if (lows[j] <= lows[i]) isLow = false;
      }
      
      if (isHigh) {
        const strength = (highs[i] - Math.min(...highs.slice(i - 5, i + 5))) / (Math.max(...highs.slice(i - 5, i + 5)) - Math.min(...highs.slice(i - 5, i + 5)));
        swingHighs.push({ price: highs[i], index: i, strength });
      }
      if (isLow) {
        const strength = (Math.max(...lows.slice(i - 5, i + 5)) - lows[i]) / (Math.max(...lows.slice(i - 5, i + 5)) - Math.min(...lows.slice(i - 5, i + 5)));
        swingLows.push({ price: lows[i], index: i, strength });
      }
    }
    
    const equalHighs = [];
    const equalLows = [];
    const tolerance = CONFIG.SMC.LIQUIDITY_SWEEP_TOLERANCE / 1000;
    
    for (let i = 0; i < swingHighs.length; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        const diff = Math.abs(swingHighs[i].price - swingHighs[j].price) / swingHighs[i].price;
        if (diff < tolerance) {
          equalHighs.push({ price: swingHighs[i].price, strength: (swingHighs[i].strength + swingHighs[j].strength) / 2 });
        }
      }
    }
    
    for (let i = 0; i < swingLows.length; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        const diff = Math.abs(swingLows[i].price - swingLows[j].price) / swingLows[i].price;
        if (diff < tolerance) {
          equalLows.push({ price: swingLows[i].price, strength: (swingLows[i].strength + swingLows[j].strength) / 2 });
        }
      }
    }
    
    const sweeps = [];
    const currentPrice = closes[closes.length - 1];
    const lastCandle = data[data.length - 1];
    
    for (const level of equalHighs) {
      if (currentPrice > level.price && lastCandle.close < level.price) {
        sweeps.push({ type: 'SELL', level: level.price, strength: level.strength, liquidityType: 'EXTERNAL' });
      }
    }
    
    for (const level of equalLows) {
      if (currentPrice < level.price && lastCandle.close > level.price) {
        sweeps.push({ type: 'BUY', level: level.price, strength: level.strength, liquidityType: 'EXTERNAL' });
      }
    }
    
    const rangeHigh = Math.max(...highs.slice(-20));
    const rangeLow = Math.min(...lows.slice(-20));
    
    return {
      sweeps,
      internal: { high: rangeHigh, low: rangeLow, mid: (rangeHigh + rangeLow) / 2 },
      external: { highs: equalHighs, lows: equalLows },
      hasSweep: sweeps.length > 0,
      strongestSweep: sweeps.length > 0 ? sweeps.reduce((a, b) => a.strength > b.strength ? a : b) : null
    };
  }

  static detectOrderBlock(data) {
    if (data.length < 30) return null;
    
    const orders = [];
    const avgVolume = data.slice(-20).reduce((a, b) => a + b.vol, 0) / 20;
    
    for (let i = data.length - 15; i < data.length - 2; i++) {
      const candle = data[i];
      const nextCandle = data[i + 1];
      const prevCandle = data[i - 1];
      
      if (!candle || !nextCandle || !prevCandle) continue;
      
      const bodySize = Math.abs(candle.close - candle.open);
      const avgBody = data.slice(i - 10, i).reduce((a, b) => a + Math.abs(b.close - b.open), 0) / 10;
      const bodyRatio = bodySize / (candle.high - candle.low);
      
      if (bodyRatio < 0.3) continue;
      if (candle.vol < avgVolume * 1.5) continue;
      if (bodySize < avgBody * 1.2) continue;
      
      if (candle.close < candle.open && nextCandle.close > nextCandle.open) {
        const strength = (nextCandle.close - nextCandle.open) / (candle.high - candle.low);
        if (strength > CONFIG.SMC.MIN_OB_STRENGTH) {
          const isMitigated = data.slice(i + 2).some(c => c.close <= candle.high && c.close >= candle.low);
          const isBreaker = data.slice(i + 2).some(c => c.close > candle.high && c.close < candle.high * 1.02);
          
          orders.push({
            type: 'BULLISH',
            price: candle.high,
            low: candle.low,
            high: candle.high,
            strength: Math.min(strength, 5),
            volumeRatio: candle.vol / avgVolume,
            isMitigated: isMitigated,
            isBreaker: isBreaker,
            timestamp: candle.time,
            bodyRatio: bodyRatio
          });
        }
      }
      
      if (candle.close > candle.open && nextCandle.close < nextCandle.open) {
        const strength = (candle.open - candle.close) / (candle.high - candle.low);
        if (strength > CONFIG.SMC.MIN_OB_STRENGTH) {
          const isMitigated = data.slice(i + 2).some(c => c.close <= candle.high && c.close >= candle.low);
          const isBreaker = data.slice(i + 2).some(c => c.close < candle.low && c.close > candle.low * 0.98);
          
          orders.push({
            type: 'BEARISH',
            price: candle.low,
            low: candle.low,
            high: candle.high,
            strength: Math.min(strength, 5),
            volumeRatio: candle.vol / avgVolume,
            isMitigated: isMitigated,
            isBreaker: isBreaker,
            timestamp: candle.time,
            bodyRatio: bodyRatio
          });
        }
      }
    }
    
    return orders.length > 0 ? orders.sort((a, b) => b.strength - a.strength)[0] : null;
  }

  static detectFVG(data) {
    if (data.length < 10) return null;
    
    const fvgs = [];
    const pipValue = 0.01;
    
    for (let i = data.length - 10; i < data.length - 1; i++) {
      const c1 = data[i];
      const c2 = data[i + 1];
      const c3 = data[i + 2];
      
      if (!c1 || !c2 || !c3) continue;
      
      if (c1.high < c3.low) {
        const size = c3.low - c1.high;
        const sizePips = size / pipValue;
        if (sizePips >= CONFIG.SMC.MIN_FVG_SIZE_PIPS) {
          const isMitigated = data.slice(i + 3).some(c => c.close <= c3.low && c.close >= c1.high);
          const encroachment = (c1.high + c3.low) / 2;
          
          fvgs.push({
            type: 'BULLISH',
            high: c3.low,
            low: c1.high,
            size: sizePips,
            strength: Math.min(sizePips / 5, 3),
            isMitigated: isMitigated,
            encroachment: encroachment,
            age: i
          });
        }
      }
      
      if (c1.low > c3.high) {
        const size = c1.low - c3.high;
        const sizePips = size / pipValue;
        if (sizePips >= CONFIG.SMC.MIN_FVG_SIZE_PIPS) {
          const isMitigated = data.slice(i + 3).some(c => c.close <= c1.low && c.close >= c3.high);
          const encroachment = (c1.low + c3.high) / 2;
          
          fvgs.push({
            type: 'BEARISH',
            high: c1.low,
            low: c3.high,
            size: sizePips,
            strength: Math.min(sizePips / 5, 3),
            isMitigated: isMitigated,
            encroachment: encroachment,
            age: i
          });
        }
      }
    }
    
    return fvgs.length > 0 ? fvgs.sort((a, b) => b.strength - a.strength)[0] : null;
  }

  static detectSMTDivergence(data, btcData, ethData) {
    if (!btcData || !ethData || data.length < 20) return null;
    
    const coinClose = data.map(d => d.close);
    const btcClose = btcData.map(d => d.close);
    const ethClose = ethData.map(d => d.close);
    
    const coinLast = coinClose[coinClose.length - 1];
    const coinPrev = coinClose[coinClose.length - 5];
    const btcLast = btcClose[btcClose.length - 1];
    const btcPrev = btcClose[btcClose.length - 5];
    const ethLast = ethClose[ethClose.length - 1];
    const ethPrev = ethClose[ethClose.length - 5];
    
    if (coinLast < coinPrev && (btcLast > btcPrev || ethLast > ethPrev)) {
      return { type: 'BULLISH', strength: 'STRONG', reason: 'SMT Divergence مع BTC/ETH' };
    }
    
    if (coinLast > coinPrev && (btcLast < btcPrev || ethLast < ethPrev)) {
      return { type: 'BEARISH', strength: 'STRONG', reason: 'SMT Divergence مع BTC/ETH' };
    }
    
    return null;
  }

  static detectBOS_CHOCH(data) {
    if (data.length < 50) return { bos: null, choch: null };
    
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const closes = data.map(d => d.close);
    
    const swingHighs = [];
    const swingLows = [];
    
    for (let i = 10; i < data.length - 10; i++) {
      let isHigh = true;
      let isLow = true;
      
      for (let j = i - 10; j <= i + 10; j++) {
        if (j === i) continue;
        if (highs[j] >= highs[i]) isHigh = false;
        if (lows[j] <= lows[i]) isLow = false;
      }
      
      if (isHigh) swingHighs.push({ price: highs[i], index: i });
      if (isLow) swingLows.push({ price: lows[i], index: i });
    }
    
    if (swingHighs.length < 3 || swingLows.length < 3) return { bos: null, choch: null };
    
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - 2];
    const lastLow = swingLows[swingLows.length - 1];
    const prevLow = swingLows[swingLows.length - 2];
    const currentPrice = closes[closes.length - 1];
    const lastCandle = data[data.length - 1];
    
    let bos = null;
    let choch = null;
    
    if (lastHigh && currentPrice > lastHigh.price && lastCandle.close > lastHigh.price) {
      bos = { type: 'BULLISH', level: lastHigh.price, strength: (currentPrice - lastHigh.price) / (lastHigh.price - (prevHigh?.price || lastHigh.price * 0.98)) };
    }
    if (lastLow && currentPrice < lastLow.price && lastCandle.close < lastLow.price) {
      bos = { type: 'BEARISH', level: lastLow.price, strength: (lastLow.price - currentPrice) / ((prevLow?.price || lastLow.price * 1.02) - lastLow.price) };
    }
    
    if (lastLow && prevLow && lastLow.price < prevLow.price &&
      lastHigh && prevHigh && lastHigh.price > prevHigh.price) {
      choch = { type: 'BULLISH', level: lastLow.price, strength: (lastHigh.price - prevHigh.price) / prevHigh.price };
    }
    if (lastHigh && prevHigh && lastHigh.price > prevHigh.price &&
      lastLow && prevLow && lastLow.price < prevLow.price) {
      choch = { type: 'BEARISH', level: lastHigh.price, strength: (prevLow.price - lastLow.price) / prevLow.price };
    }
    
    return { bos, choch };
  }

  static getCurrentKillZone() {
    const now = new Date();
    const hours = now.getUTCHours();
    const minutes = now.getUTCMinutes();
    const time = hours + minutes / 60;
    
    const zones = CONFIG.KILL_ZONES;
    let activeZone = null;
    
    if (time >= zones.LONDON.start && time < zones.LONDON.end) {
      activeZone = { name: 'LONDON', start: zones.LONDON.start, end: zones.LONDON.end };
    } else if (time >= zones.NEW_YORK.start && time < zones.NEW_YORK.end) {
      activeZone = { name: 'NEW_YORK', start: zones.NEW_YORK.start, end: zones.NEW_YORK.end };
    } else if (time >= zones.ASIA.start || time < zones.ASIA.end) {
      activeZone = { name: 'ASIA', start: zones.ASIA.start, end: zones.ASIA.end };
    }
    
    return activeZone;
  }
}

// ======================= 7. Daily Bias المتقدم =======================

class AdvancedDailyBias {
  static async analyze(symbol, dataDaily, data4h, data1h, btcData, ethData) {
    const scores = { trend: 0, premiumDiscount: 0, session: 0, volume: 0, oi: 0, funding: 0, btc: 0, dominance: 0 };
    
    if (dataDaily) {
      const closes = dataDaily.map(d => d.close);
      const ema20 = AdvancedIndicators.ema(closes, 20);
      const ema50 = AdvancedIndicators.ema(closes, 50);
      const currentPrice = closes[closes.length - 1];
      
      if (currentPrice > ema20 && ema20 > ema50) scores.trend = 1;
      else if (currentPrice < ema20 && ema20 < ema50) scores.trend = -1;
    }
    
    if (data4h) {
      const highs = data4h.map(d => d.high);
      const lows = data4h.map(d => d.low);
      const high = Math.max(...highs);
      const low = Math.min(...lows);
      const currentPrice = data4h[data4h.length - 1].close;
      const mid = (high + low) / 2;
      
      if (currentPrice < mid) scores.premiumDiscount = 1;
      else if (currentPrice > mid) scores.premiumDiscount = -1;
    }
    
    if (data1h) {
      const closes = data1h.map(d => d.close);
      const open = data1h[0].open;
      const close = closes[closes.length - 1];
      
      if (close > open) scores.session = 1;
      else if (close < open) scores.session = -1;
    }
    
    if (dataDaily) {
      const volumes = dataDaily.map(d => d.vol);
      const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
      const currentVolume = volumes[volumes.length - 1];
      
      if (currentVolume > avgVolume * 1.2) scores.volume = 1;
      else if (currentVolume < avgVolume * 0.8) scores.volume = -1;
    }
    
    try {
      const oi = await getOpenInterestUSD(symbol);
      if (oi) {
        const oiData = await getOpenInterestHistory(symbol);
        if (oiData && oiData.length > 0) {
          const avgOI = oiData.reduce((a, b) => a + b, 0) / oiData.length;
          if (oi > avgOI * 1.1) scores.oi = 1;
          else if (oi < avgOI * 0.9) scores.oi = -1;
        }
      }
    } catch {}
    
    try {
      const funding = await getFundingRate(symbol);
      if (funding !== null) {
        if (funding < -0.0001) scores.funding = 1;
        else if (funding > 0.0001) scores.funding = -1;
      }
    } catch {}
    
    if (btcData) {
      const btcCloses = btcData.map(d => d.close);
      const btcChange = (btcCloses[btcCloses.length - 1] - btcCloses[btcCloses.length - 5]) / btcCloses[btcCloses.length - 5];
      if (btcChange > 0.01) scores.btc = 1;
      else if (btcChange < -0.01) scores.btc = -1;
    }
    
    try {
      const dominance = await getBTCDominance();
      if (dominance !== null) {
        if (dominance > 55) scores.dominance = -1;
        else if (dominance < 45) scores.dominance = 1;
      }
    } catch {}
    
    const weights = CONFIG.DAILY_BIAS;
    let totalScore = 0;
    for (const [key, score] of Object.entries(scores)) {
      const weightKey = `WEIGHT_${key.toUpperCase()}`;
      totalScore += score * (weights[weightKey] || 0.1);
    }
    
    const threshold = 0.15;
    let bias = 'NEUTRAL';
    let confidence = 0;
    
    if (totalScore > threshold) {
      bias = 'BULLISH';
      confidence = Math.min(totalScore, 1);
    } else if (totalScore < -threshold) {
      bias = 'BEARISH';
      confidence = Math.min(Math.abs(totalScore), 1);
    }
    
    return { bias, confidence, scores, details: {
      trend: scores.trend,
      premiumDiscount: scores.premiumDiscount,
      session: scores.session,
      volume: scores.volume,
      oi: scores.oi,
      funding: scores.funding,
      btc: scores.btc,
      dominance: scores.dominance
    }};
  }
}

// ======================= 8. نظام التعلم المؤسسي =======================

class InstitutionalLearningSystem {
  constructor(kv) {
    this.kv = kv;
    this.stats = null;
  }

  async initialize() {
    const saved = await this.kv?.get('INSTITUTIONAL_STATS');
    this.stats = saved ? JSON.parse(saved) : this.getDefaultStats();
  }

  getDefaultStats() {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      indicatorPerformance: {
        bos: { wins: 0, total: 0, profit: 0 },
        choch: { wins: 0, total: 0, profit: 0 },
        fvg: { wins: 0, total: 0, profit: 0 },
        ob: { wins: 0, total: 0, profit: 0 },
        sweep: { wins: 0, total: 0, profit: 0 },
        volume: { wins: 0, total: 0, profit: 0 },
        rsi: { wins: 0, total: 0, profit: 0 },
        dailyBias: { wins: 0, total: 0, profit: 0 },
        smt: { wins: 0, total: 0, profit: 0 },
        vwap: { wins: 0, total: 0, profit: 0 }
      },
      coinPerformance: {},
      timePerformance: {},
      dayPerformance: {},
      trendPerformance: {
        BULLISH: { wins: 0, total: 0, profit: 0 },
        BEARISH: { wins: 0, total: 0, profit: 0 },
        NEUTRAL: { wins: 0, total: 0, profit: 0 }
      },
      riskMetrics: {
        maxDrawdown: 0,
        averageWin: 0,
        averageLoss: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        expectancy: 0,
        winRate: 0
      },
      lastUpdated: Date.now()
    };
  }

  async update(trade) {
    const stats = this.stats;
    stats.totalTrades++;
    if (trade.result === 'WIN') stats.wins++;
    else stats.losses++;
    stats.winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;

    if (trade.indicators) {
      Object.keys(trade.indicators).forEach(ind => {
        if (stats.indicatorPerformance[ind]) {
          stats.indicatorPerformance[ind].total++;
          if (trade.result === 'WIN') stats.indicatorPerformance[ind].wins++;
          stats.indicatorPerformance[ind].profit += trade.profit || 0;
        }
      });
    }

    if (!stats.coinPerformance[trade.coin]) {
      stats.coinPerformance[trade.coin] = { wins: 0, total: 0, profit: 0 };
    }
    stats.coinPerformance[trade.coin].total++;
    if (trade.result === 'WIN') stats.coinPerformance[trade.coin].wins++;
    stats.coinPerformance[trade.coin].profit += trade.profit || 0;

    const hour = new Date(trade.closedAt).getHours();
    if (!stats.timePerformance[hour]) {
      stats.timePerformance[hour] = { wins: 0, total: 0, profit: 0 };
    }
    stats.timePerformance[hour].total++;
    if (trade.result === 'WIN') stats.timePerformance[hour].wins++;
    stats.timePerformance[hour].profit += trade.profit || 0;

    const day = new Date(trade.closedAt).getDay();
    if (!stats.dayPerformance[day]) {
      stats.dayPerformance[day] = { wins: 0, total: 0, profit: 0 };
    }
    stats.dayPerformance[day].total++;
    if (trade.result === 'WIN') stats.dayPerformance[day].wins++;
    stats.dayPerformance[day].profit += trade.profit || 0;

    if (trade.trend) {
      stats.trendPerformance[trade.trend].total++;
      if (trade.result === 'WIN') stats.trendPerformance[trade.trend].wins++;
      stats.trendPerformance[trade.trend].profit += trade.profit || 0;
    }

    this.updateRiskMetrics(trade);
    stats.lastUpdated = Date.now();
    await this.kv?.put('INSTITUTIONAL_STATS', JSON.stringify(stats));
  }

  updateRiskMetrics(trade) {
    const stats = this.stats;
    const profit = trade.profit || 0;

    if (profit > 0) {
      stats.riskMetrics.averageWin = ((stats.riskMetrics.averageWin * (stats.wins - 1)) + profit) / stats.wins;
    } else {
      stats.riskMetrics.averageLoss = ((stats.riskMetrics.averageLoss * (stats.losses - 1)) + Math.abs(profit)) / stats.losses;
    }

    const allTrades = stats.indicatorPerformance;
    let totalWin = 0;
    let totalLoss = 0;
    
    for (const [ind, data] of Object.entries(allTrades)) {
      if (data.profit > 0) totalWin += data.profit;
      else totalLoss += Math.abs(data.profit);
    }
    
    stats.riskMetrics.profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;
    stats.riskMetrics.expectancy = (stats.wins * stats.riskMetrics.averageWin - stats.losses * stats.riskMetrics.averageLoss) / stats.totalTrades;
  }

  getOptimalWeights() {
    const stats = this.stats;
    const weights = {
      bos: 15, choch: 10, fvg: 10, ob: 15, sweep: 15,
      volume: 10, rsi: 5, dailyBias: 20, smt: 10, vwap: 8
    };

    Object.keys(weights).forEach(ind => {
      const perf = stats.indicatorPerformance[ind];
      if (perf && perf.total > 20) {
        const winRate = perf.wins / perf.total;
        if (winRate > 0.7) weights[ind] = Math.min(weights[ind] + 3, 30);
        else if (winRate < 0.45) weights[ind] = Math.max(weights[ind] - 3, 5);
      }
    });

    return weights;
  }

  getBestTimeToTrade() {
    const stats = this.stats;
    let bestHour = null;
    let bestWinRate = 0;

    Object.keys(stats.timePerformance).forEach(hour => {
      const perf = stats.timePerformance[hour];
      if (perf.total > 5) {
        const winRate = perf.wins / perf.total;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestHour = parseInt(hour);
        }
      }
    });

    return bestHour;
  }

  getBestDayToTrade() {
    const stats = this.stats;
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    let bestDay = null;
    let bestWinRate = 0;

    Object.keys(stats.dayPerformance).forEach(day => {
      const perf = stats.dayPerformance[day];
      if (perf.total > 5) {
        const winRate = perf.wins / perf.total;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestDay = parseInt(day);
        }
      }
    });

    return bestDay !== null ? days[bestDay] : 'N/A';
  }
}

// ======================= 9. نظام التقييم المؤسسي =======================

class InstitutionalScoring {
  static async calculateScore(coin, data15m, data1h, data4h, dataDaily, currentPrice, btcBullish, btcData, ethData, intendedDirection, learningSystem) {
    let score = 0;
    let reasons = [];
    const weights = learningSystem ? learningSystem.getOptimalWeights() : {
      bos: 15, choch: 10, fvg: 10, ob: 15, sweep: 15,
      volume: 10, rsi: 5, dailyBias: 20, smt: 10, vwap: 8
    };
    
    const dailyBias = await AdvancedDailyBias.analyze(coin + 'USDT', dataDaily, data4h, data1h, btcData, ethData);
    
    if (dailyBias.bias === 'BULLISH' && intendedDirection === 'LONG') {
      const weight = weights.dailyBias * dailyBias.confidence;
      score += weight;
      reasons.push(`📅 Daily Bias صاعد (${(dailyBias.confidence * 100).toFixed(0)}%) (+${weight.toFixed(0)})`);
    } else if (dailyBias.bias === 'BEARISH' && intendedDirection === 'SHORT') {
      const weight = weights.dailyBias * dailyBias.confidence;
      score += weight;
      reasons.push(`📅 Daily Bias هابط (${(dailyBias.confidence * 100).toFixed(0)}%) (+${weight.toFixed(0)})`);
    } else if (dailyBias.bias !== 'NEUTRAL') {
      score -= 15;
      reasons.push(`⚠️ Daily Bias معاكس (-15)`);
    }
    
    const smc = AdvancedSMC;
    const { bos, choch } = smc.detectBOS_CHOCH(data15m);
    
    if (bos && bos.type === 'BULLISH' && intendedDirection === 'LONG') {
      score += weights.bos * Math.min(bos.strength, 1.5);
      reasons.push(`🚀 BOS صاعد (+${(weights.bos * Math.min(bos.strength, 1.5)).toFixed(0)})`);
    }
    if (bos && bos.type === 'BEARISH' && intendedDirection === 'SHORT') {
      score += weights.bos * Math.min(bos.strength, 1.5);
      reasons.push(`📉 BOS هابط (+${(weights.bos * Math.min(bos.strength, 1.5)).toFixed(0)})`);
    }
    
    if (choch && choch.type === 'BULLISH' && intendedDirection === 'LONG') {
      score += weights.choch * Math.min(choch.strength, 1.5);
      reasons.push(`🔄 CHoCH صاعد (+${(weights.choch * Math.min(choch.strength, 1.5)).toFixed(0)})`);
    }
    if (choch && choch.type === 'BEARISH' && intendedDirection === 'SHORT') {
      score += weights.choch * Math.min(choch.strength, 1.5);
      reasons.push(`🔄 CHoCH هابط (+${(weights.choch * Math.min(choch.strength, 1.5)).toFixed(0)})`);
    }
    
    const fvg = smc.detectFVG(data15m);
    if (fvg && fvg.type === 'BULLISH' && intendedDirection === 'LONG' && !fvg.isMitigated) {
      score += weights.fvg * fvg.strength;
      reasons.push(`📊 FVG صاعد (+${(weights.fvg * fvg.strength).toFixed(0)})`);
    }
    if (fvg && fvg.type === 'BEARISH' && intendedDirection === 'SHORT' && !fvg.isMitigated) {
      score += weights.fvg * fvg.strength;
      reasons.push(`📊 FVG هابط (+${(weights.fvg * fvg.strength).toFixed(0)})`);
    }
    
    const ob = smc.detectOrderBlock(data15m);
    if (ob && ob.type === 'BULLISH' && intendedDirection === 'LONG' && !ob.isMitigated) {
      score += weights.ob * ob.strength / 3;
      reasons.push(`🏛️ OB صاعد (+${(weights.ob * ob.strength / 3).toFixed(0)})`);
    }
    if (ob && ob.type === 'BEARISH' && intendedDirection === 'SHORT' && !ob.isMitigated) {
      score += weights.ob * ob.strength / 3;
      reasons.push(`🏛️ OB هابط (+${(weights.ob * ob.strength / 3).toFixed(0)})`);
    }
    
    const liquidity = smc.detectLiquidity(data15m);
    if (liquidity.hasSweep && liquidity.strongestSweep) {
      const sweep = liquidity.strongestSweep;
      if (sweep.type === 'BUY' && intendedDirection === 'LONG') {
        score += weights.sweep * sweep.strength;
        reasons.push(`🦅 Sweep صاعد (+${(weights.sweep * sweep.strength).toFixed(0)})`);
      }
      if (sweep.type === 'SELL' && intendedDirection === 'SHORT') {
        score += weights.sweep * sweep.strength;
        reasons.push(`🦅 Sweep هابط (+${(weights.sweep * sweep.strength).toFixed(0)})`);
      }
    }
    
    const smt = smc.detectSMTDivergence(data15m, btcData, ethData);
    if (smt) {
      if (smt.type === 'BULLISH' && intendedDirection === 'LONG') {
        score += weights.smt;
        reasons.push(`🌊 SMT صاعد (+${weights.smt})`);
      }
      if (smt.type === 'BEARISH' && intendedDirection === 'SHORT') {
        score += weights.smt;
        reasons.push(`🌊 SMT هابط (+${weights.smt})`);
      }
    }
    
    const vwap = AdvancedIndicators.calculateVWAP(data15m);
    if (vwap) {
      if (intendedDirection === 'LONG' && currentPrice < vwap * 0.99) {
        score += weights.vwap;
        reasons.push(`📊 تحت VWAP (+${weights.vwap})`);
      }
      if (intendedDirection === 'SHORT' && currentPrice > vwap * 1.01) {
        score += weights.vwap;
        reasons.push(`📊 فوق VWAP (+${weights.vwap})`);
      }
    }
    
    const vp = AdvancedIndicators.calculateVolumeProfile(data15m);
    if (vp) {
      if (intendedDirection === 'LONG' && currentPrice < vp.valueAreaLow) {
        score += 5;
        reasons.push(`📊 تحت منطقة القيمة (+5)`);
      }
      if (intendedDirection === 'SHORT' && currentPrice > vp.valueAreaHigh) {
        score += 5;
        reasons.push(`📊 فوق منطقة القيمة (+5)`);
      }
    }
    
    const cvd = AdvancedIndicators.calculateCVD(data15m);
    if (cvd && cvd.divergence) {
      if (cvd.divergence.type === 'BULLISH' && intendedDirection === 'LONG') {
        score += 8;
        reasons.push(`📊 CVD Divergence صاعد (+8)`);
      }
      if (cvd.divergence.type === 'BEARISH' && intendedDirection === 'SHORT') {
        score += 8;
        reasons.push(`📊 CVD Divergence هابط (+8)`);
      }
    }
    
    const vol = data15m[data15m.length - 1].vol;
    const avgVol = data15m.slice(-20).reduce((a, b) => a + b.vol, 0) / 20;
    const volRatio = vol / avgVol;
    const usdtVolume = vol * currentPrice;
    
    if (usdtVolume > CONFIG.INSTITUTIONAL.MIN_VOLUME_USD) {
      score += weights.volume;
      reasons.push(`💰 حجم > 10M$ (+${weights.volume})`);
    }
    if (volRatio > 1.5) {
      score += weights.volume * 0.5;
      reasons.push(`🔥 حجم مرتفع (+${(weights.volume * 0.5).toFixed(0)})`);
    }
    
    const rsiVal = AdvancedIndicators.wilderRSI(data15m.map(d => d.close));
    if (intendedDirection === 'LONG' && rsiVal >= CONFIG.RSI.BULLISH_MIN && rsiVal <= CONFIG.RSI.BULLISH_MAX) {
      score += weights.rsi;
      reasons.push(`📊 RSI صاعد ${rsiVal} (+${weights.rsi})`);
    } else if (intendedDirection === 'SHORT' && rsiVal >= CONFIG.RSI.BEARISH_MIN && rsiVal <= CONFIG.RSI.BEARISH_MAX) {
      score += weights.rsi;
      reasons.push(`📊 RSI هابط ${rsiVal} (+${weights.rsi})`);
    } else if (intendedDirection === 'LONG' && rsiVal < CONFIG.RSI.OVERSOLD) {
      score += weights.rsi * 0.8;
      reasons.push(`🟢 RSI ذروة بيع ${rsiVal} (+${(weights.rsi * 0.8).toFixed(0)})`);
    } else if (intendedDirection === 'SHORT' && rsiVal > CONFIG.RSI.OVERBOUGHT) {
      score += weights.rsi * 0.8;
      reasons.push(`🔴 RSI ذروة شراء ${rsiVal} (+${(weights.rsi * 0.8).toFixed(0)})`);
    }
    
    if (btcBullish) {
      if (intendedDirection === 'LONG') {
        score += 10;
        reasons.push(`🟢 BTC صاعد (+10)`);
      } else {
        score -= CONFIG.BTC_FILTER.SHORT_PENALTY_WHEN_BULLISH;
        reasons.push(`🔴 BTC صاعد - SHORT مخفض (-${CONFIG.BTC_FILTER.SHORT_PENALTY_WHEN_BULLISH})`);
      }
    } else {
      if (intendedDirection === 'SHORT') {
        score += 10;
        reasons.push(`🟢 BTC هابط - دعم SHORT (+10)`);
      } else {
        score -= CONFIG.BTC_FILTER.LONG_PENALTY_WHEN_BEARISH;
        reasons.push(`🔴 BTC هابط - LONG مخفض (-${CONFIG.BTC_FILTER.LONG_PENALTY_WHEN_BEARISH})`);
      }
    }
    
    const killZone = smc.getCurrentKillZone();
    if (killZone) {
      if ((killZone.name === 'LONDON' || killZone.name === 'NEW_YORK') && (intendedDirection === 'LONG' || intendedDirection === 'SHORT')) {
        score += 10;
        reasons.push(`⏰ منطقة ${killZone.name} النشطة (+10)`);
      }
    }
    
    const hasLiquidity = await checkLiquidity(coin + 'USDT');
    if (!hasLiquidity) {
      score -= 30;
      reasons.push(`⚠️ سيولة منخفضة (-30)`);
    }
    
    return {
      score: Math.min(Math.max(score, 0), 100),
      reasons,
      rsiVal,
      volRatio,
      dailyBias,
      bos,
      choch,
      fvg,
      ob,
      liquidity,
      smt,
      vwap,
      cvd,
      killZone
    };
  }
}

// ======================= 10. دوال جلب البيانات =======================

async function getData(symbol, interval = '15m', limit = 200, forceFresh = false) {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  const now = Date.now();
  
  if (!forceFresh && dataCache.has(cacheKey)) {
    const cached = dataCache.get(cacheKey);
    if (now - cached.timestamp < CONFIG.CACHE_TTL_MS) return cached.data;
  }
  
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json();
    const formatted = data.map(c => ({
      time: new Date(c[0]),
      open: +c[1],
      high: +c[2],
      low: +c[3],
      close: +c[4],
      vol: +c[5]
    }));
    dataCache.set(cacheKey, { data: formatted, timestamp: now });
    return formatted;
  } catch { return null; }
}

async function getOpenInterestUSD(symbol) {
  const now = Date.now();
  if (oiCache.has(symbol)) {
    const cached = oiCache.get(symbol);
    if (now - cached.timestamp < CONFIG.CACHE_TTL_MS) return cached.oi;
  }
  try {
    const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=1`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    const oi = parseFloat(data[0].sumOpenInterest);
    const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!priceRes.ok) return null;
    const priceData = await priceRes.json();
    const price = parseFloat(priceData.price);
    const oiUSD = oi * price;
    oiCache.set(symbol, { oi: oiUSD, timestamp: now });
    return oiUSD;
  } catch { return null; }
}

async function getOpenInterestHistory(symbol) {
  try {
    const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=10`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(d => parseFloat(d.sumOpenInterest));
  } catch { return []; }
}

async function getFundingRate(symbol) {
  const now = Date.now();
  if (fundingCache.has(symbol)) {
    const cached = fundingCache.get(symbol);
    if (now - cached.timestamp < CONFIG.CACHE_TTL_MS) return cached.rate;
  }
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = parseFloat(data.lastFundingRate);
    fundingCache.set(symbol, { rate, timestamp: now });
    return rate;
  } catch { return null; }
}

async function isBTCBullish() {
  const now = Date.now();
  if (btcCache !== null && now - btcCacheTime < 5 * 60 * 1000) return btcCache;
  try {
    const data1h = await getData('BTCUSDT', '1h', 200);
    const data4h = await getData('BTCUSDT', '4h', 200);
    if (!data1h || !data4h) return false;
    const closes1h = data1h.map(d => d.close);
    const closes4h = data4h.map(d => d.close);
    const ema200_1h = AdvancedIndicators.ema(closes1h, 200);
    const ema200_4h = AdvancedIndicators.ema(closes4h, 200);
    const currentPrice = closes1h[closes1h.length - 1];
    const lastDayChange = (closes1h[closes1h.length - 1] - closes1h[closes1h.length - 24]) / closes1h[closes1h.length - 24];
    btcCache = (currentPrice > ema200_1h && currentPrice > ema200_4h && lastDayChange > -0.03);
    btcCacheTime = now;
    return btcCache;
  } catch { return false; }
}

async function getBTCDominance() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    const data = await res.json();
    return parseFloat(data.data.market_cap_percentage.btc);
  } catch { return null; }
}

async function fetchAlphaCoins() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const data = await res.json();
    const usdtPairs = data.filter(i =>
      i.symbol.endsWith('USDT') &&
      !STABLE_COINS_BLACKLIST.some(stable => i.symbol.startsWith(stable))
    );
    const filtered = usdtPairs.map(pair => ({
      symbol: pair.symbol.replace('USDT', ''),
      volumeUSD: parseFloat(pair.quoteVolume),
      change24h: parseFloat(pair.priceChangePercent),
      price: parseFloat(pair.lastPrice),
      count: parseInt(pair.count)
    }))
      .filter(c =>
        c.volumeUSD > CONFIG.INSTITUTIONAL.MIN_VOLUME_ALPHA &&
        c.count > 5000
      )
      .sort((a, b) => b.volumeUSD - a.volumeUSD)
      .slice(0, 20);
    return filtered.map(c => c.symbol);
  } catch (e) { return []; }
}

async function checkLiquidity(symbol) {
  try {
    const stats = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`).then(r => r.json());
    const volumeUSD = parseFloat(stats.quoteVolume);
    const count = parseInt(stats.count);
    return (volumeUSD >= CONFIG.INSTITUTIONAL.MIN_VOLUME_USD && count >= 5000);
  } catch { return false; }
}

async function checkFundingAndOI(symbol, intendedSide) {
  try {
    const fundingRate = await getFundingRate(symbol);
    const oiUSD = await getOpenInterestUSD(symbol);
    if (fundingRate === null || oiUSD === null) return true;
    if (oiUSD < CONFIG.INSTITUTIONAL.MIN_OI_USD) return false;
    if (intendedSide === 'LONG' && fundingRate > CONFIG.INSTITUTIONAL.MAX_FUNDING_RATE) return false;
    if (intendedSide === 'SHORT' && fundingRate < CONFIG.INSTITUTIONAL.MIN_FUNDING_RATE) return false;
    return true;
  } catch { return true; }
}

// ======================= 11. معالجة العملات =======================

async function processCoin(coin, kv, btcBullish, btcData, ethData, direction = 'LONG', learningSystem) {
  try {
    const symbol = coin + 'USDT';
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return;

    let cooldown = kv ? JSON.parse(await kv.get('COOLDOWN') || '{}') : {};
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < CONFIG.COOLDOWN_HOURS * 60 * 60 * 1000) return;

    let lastDirection = kv ? await kv.get(`LAST_DIR_${symbol}`) : null;
    if (lastDirection && Date.now() - parseInt(lastDirection.split('|')[1]) < 24 * 60 * 60 * 1000) {
      if (lastDirection.split('|')[0] === direction) return;
    }

    const [data5m, data15m, data1h, data4h, dataDaily] = await Promise.all([
      getData(symbol, '5m', 100),
      getData(symbol, '15m', 200),
      getData(symbol, '1h', 200),
      getData(symbol, '4h', 100),
      getData(symbol, '1d', 30)
    ]);

    if (!data5m || !data15m || !data1h || !data4h || !dataDaily) return;

    const currentPrice = data15m[data15m.length - 1].close;
    const { score, reasons, rsiVal, volRatio, dailyBias, bos, choch, fvg, ob, liquidity, smt, vwap, cvd, killZone } =
      await InstitutionalScoring.calculateScore(
        coin, data15m, data1h, data4h, dataDaily,
        currentPrice, btcBullish, btcData, ethData,
        direction, learningSystem
      );

    if (direction === 'LONG' && dailyBias.bias === 'BEARISH') return;
    if (direction === 'SHORT' && dailyBias.bias === 'BULLISH') return;
    if (dailyBias.bias === 'NEUTRAL') return;

    const hasGoodFunding = await checkFundingAndOI(symbol, direction);
    if (!hasGoodFunding) return;

    const atr = AdvancedIndicators.calculateATR(data15m);
    let tp1, tp2, tp3, sl;

    if (atr && atr > 0) {
      if (direction === 'LONG') {
        tp1 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[0]);
        tp2 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[1]);
        tp3 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[2]);
        sl = currentPrice - (atr * 1);
      } else {
        tp1 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[0]);
        tp2 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[1]);
        tp3 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[2]);
        sl = currentPrice + (atr * 1);
      }
    } else {
      if (direction === 'LONG') {
        tp1 = currentPrice * 1.03;
        tp2 = currentPrice * 1.06;
        tp3 = currentPrice * 1.10;
        sl = currentPrice * 0.97;
      } else {
        tp1 = currentPrice * 0.97;
        tp2 = currentPrice * 0.94;
        tp3 = currentPrice * 0.90;
        sl = currentPrice * 1.03;
      }
    }

    const rr = direction === 'LONG' ? ((tp3 - currentPrice) / (currentPrice - sl)) : ((currentPrice - tp3) / (sl - currentPrice));
    if (rr < CONFIG.MIN_RISK_REWARD) return;

    let signalType = '🔵 WATCHLIST';
    let emoji = '🔵';
    if (score >= CONFIG.SCORE_STRONG) {
      signalType = '🟢 STRONG BUY';
      emoji = '🟢';
    } else if (score >= CONFIG.SCORE_BUY) {
      signalType = '🟡 BUY';
      emoji = '🟡';
    }

    let msg = `${emoji} *${signalType} - ${score}%* ${emoji}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🪙 *${coin}/USDT*\n`;
    msg += `🎯 *${direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
    msg += `💰 *$${currentPrice.toFixed(8)}*\n\n`;
    msg += `📊 *R/R: 1:${rr.toFixed(2)}*\n`;
    msg += `🎯 TP1: *$${tp1.toFixed(8)}*\n`;
    msg += `🎯 TP2: *$${tp2.toFixed(8)}*\n`;
    msg += `🎯 TP3: *$${tp3.toFixed(8)}*\n`;
    msg += `🛑 SL: *$${sl.toFixed(8)}*\n\n`;
    msg += `📌 *الأسباب:*\n`;
    msg += `${reasons.slice(0, 8).join("\n")}\n\n`;
    msg += `📊 RSI: ${rsiVal} | VOL: ${volRatio.toFixed(1)}x\n`;
    msg += `📈 Daily Bias: ${dailyBias.bias} (${(dailyBias.confidence * 100).toFixed(0)}%)\n`;
    msg += `⏰ ${killZone ? `Kill Zone: ${killZone.name}` : 'خارج الجلسة'}\n`;
    msg += `⚡ *V10.0 Institutional Ultimate*`;

    await sendTelegram(REQUIRED_CHANNEL, msg);

    if (kv) {
      let active = JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]');
      active.push({
        coin,
        symbol: coin,
        side: direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉',
        entry: currentPrice,
        tp1,
        tp2,
        tp3,
        sl,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        status: 'OPEN',
        timestamp: Date.now(),
        score,
        rr,
        dailyBias: dailyBias.bias,
        indicators: {
          bos: !!bos,
          choch: !!choch,
          fvg: !!fvg && !fvg.isMitigated,
          ob: !!ob && !ob.isMitigated,
          sweep: liquidity?.hasSweep || false,
          smt: !!smt,
          vwap: !!vwap,
          cvd: !!cvd
        }
      });
      await kv.put('ACTIVE_SIGNALS', JSON.stringify(active));
      cooldown[symbol] = Date.now();
      await kv.put('COOLDOWN', JSON.stringify(cooldown));
      await kv.put(`LAST_DIR_${symbol}`, `${direction}|${Date.now()}`);
      await kv.put('SIGNALS_TODAY', (signalsToday + 1).toString());
    }

  } catch (e) {
    console.error(`Error ${coin}:`, e);
  }
}

// ======================= 12. الماسح الضوئي المؤسسي =======================

async function institutionalScanner(env) {
  console.log('🔄 Institutional V10.0 Scanner Starting...');

  const kv = env?.SIGNALS_KV;
  const learningSystem = new InstitutionalLearningSystem(kv);
  await learningSystem.initialize();

  await manageActiveSignals(kv, learningSystem);

  const btcBullish = await isBTCBullish();
  const [btcData, ethData] = await Promise.all([
    getData('BTCUSDT', '15m', 100),
    getData('ETHUSDT', '15m', 100)
  ]);

  let watchList = [...INSTITUTIONAL_WATCH_LIST];

  const alphaCoins = await fetchAlphaCoins();
  if (alphaCoins.length > 0) {
    watchList = [...new Set([...watchList, ...alphaCoins])].slice(0, 35);
    console.log(`📊 تم إضافة ${alphaCoins.length} عملة ألفا جديدة`);
  }

  for (const direction of ['LONG', 'SHORT']) {
    for (let i = 0; i < watchList.length; i += CONFIG.BATCH_SIZE) {
      const batch = watchList.slice(i, i + CONFIG.BATCH_SIZE);
      await Promise.all(batch.map(coin =>
        processCoin(coin, kv, btcBullish, btcData, ethData, direction, learningSystem)
      ));
      await delay(CONFIG.DELAY);
    }
  }

  console.log('✅ Institutional V10.0 Scan Complete');
}

// ======================= 13. إدارة الإشارات النشطة =======================

async function manageActiveSignals(kv, learningSystem) {
  let active = [], history = [];
  if (kv) {
    active = JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]');
    history = JSON.parse(await kv.get('HISTORY_SIGNALS') || '[]');
  }

  const updatedActive = [];
  for (const sig of active) {
    try {
      const data = await getData(sig.symbol + 'USDT', '5m', 10);
      if (!data) { updatedActive.push(sig); continue; }

      const currentPrice = data[data.length - 1].close;
      let closed = false;
      let profit = 0;

      if (sig.side === 'LONG 📈') {
        if (currentPrice >= sig.tp1 && !sig.tp1Hit) {
          sig.tp1Hit = true;
          await sendTelegram(REQUIRED_CHANNEL,
            `🎯 *TP1 HIT* 🎯\n🪙 *${sig.coin}*\n💰 +${((sig.tp1 - sig.entry) / sig.entry * 100).toFixed(2)}%`
          );
        }
        if (currentPrice >= sig.tp2 && !sig.tp2Hit) {
          sig.tp2Hit = true;
          await sendTelegram(REQUIRED_CHANNEL,
            `🎯 *TP2 HIT* 🎯\n🪙 *${sig.coin}*\n💰 +${((sig.tp2 - sig.entry) / sig.entry * 100).toFixed(2)}%`
          );
        }
        if (currentPrice >= sig.tp3 && !sig.tp3Hit) {
          sig.tp3Hit = true;
          profit = ((sig.tp3 - sig.entry) / sig.entry) * 100;
          await sendTelegram(REQUIRED_CHANNEL,
            `🏆 *TP3 HIT* 🏆\n🪙 *${sig.coin}*\n💰 +${profit.toFixed(2)}%\n✅ صفقة كاملة!`
          );
          sig.status = 'WIN';
          sig.closedAt = Date.now();
          sig.finalProfit = profit;
          closed = true;
        }
        if (currentPrice <= sig.sl && !closed) {
          profit = ((sig.sl - sig.entry) / sig.entry) * 100;
          await sendTelegram(REQUIRED_CHANNEL,
            `🔴 *STOP LOSS* 🔴\n🪙 *${sig.coin}*\n📉 ${profit.toFixed(2)}%`
          );
          sig.status = 'LOSS';
          sig.closedAt = Date.now();
          sig.finalProfit = profit;
          closed = true;
        }
      } else {
        if (currentPrice <= sig.tp1 && !sig.tp1Hit) {
          sig.tp1Hit = true;
          await sendTelegram(REQUIRED_CHANNEL,
            `🎯 *TP1 HIT* 🎯\n🪙 *${sig.coin}* (SHORT)\n💰 +${((sig.entry - sig.tp1) / sig.entry * 100).toFixed(2)}%`
          );
        }
        if (currentPrice <= sig.tp2 && !sig.tp2Hit) {
          sig.tp2Hit = true;
          await sendTelegram(REQUIRED_CHANNEL,
            `🎯 *TP2 HIT* 🎯\n🪙 *${sig.coin}* (SHORT)\n💰 +${((sig.entry - sig.tp2) / sig.entry * 100).toFixed(2)}%`
          );
        }
        if (currentPrice <= sig.tp3 && !sig.tp3Hit) {
          sig.tp3Hit = true;
          profit = ((sig.entry - sig.tp3) / sig.entry) * 100;
          await sendTelegram(REQUIRED_CHANNEL,
            `🏆 *TP3 HIT* 🏆\n🪙 *${sig.coin}* (SHORT)\n💰 +${profit.toFixed(2)}%\n✅ صفقة كاملة!`
          );
          sig.status = 'WIN';
          sig.closedAt = Date.now();
          sig.finalProfit = profit;
          closed = true;
        }
        if (currentPrice >= sig.sl && !closed) {
          profit = ((sig.sl - sig.entry) / sig.entry) * 100;
          await sendTelegram(REQUIRED_CHANNEL,
            `🔴 *STOP LOSS* 🔴\n🪙 *${sig.coin}* (SHORT)\n📉 ${profit.toFixed(2)}%`
          );
          sig.status = 'LOSS';
          sig.closedAt = Date.now();
          sig.finalProfit = profit;
          closed = true;
        }
      }

      if (closed) {
        await learningSystem.update({
          ...sig,
          result: sig.status,
          closedAt: sig.closedAt,
          coin: sig.coin,
          profit: sig.finalProfit,
          trend: sig.dailyBias || 'NEUTRAL'
        });
        history.unshift(sig);
      } else {
        updatedActive.push(sig);
      }
    } catch (e) {
      updatedActive.push(sig);
    }
  }

  if (kv) {
    await kv.put('ACTIVE_SIGNALS', JSON.stringify(updatedActive));
    await kv.put('HISTORY_SIGNALS', JSON.stringify(history.slice(0, 500)));
  }
}

// ======================= 14. Dashboard =======================

function getDashboardHTML(activeSignals, history, learningSystem) {
  const stats = learningSystem?.stats || {};
  const wins = history.filter(s => s.status === 'WIN').length;
  const losses = history.filter(s => s.status === 'LOSS').length;
  const totalProfit = history.reduce((sum, s) => sum + (s.finalProfit || 0), 0);
  const winRate = history.length ? ((wins / history.length) * 100).toFixed(1) : 0;

  const topCoins = Object.entries(stats.coinPerformance || {})
    .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))
    .slice(0, 5);

  const bestTime = learningSystem?.getBestTimeToTrade();
  const bestDay = learningSystem?.getBestDayToTrade();
  const riskMetrics = stats.riskMetrics || {};

  const longTrades = history.filter(s => s.side === 'LONG 📈');
  const shortTrades = history.filter(s => s.side === 'SHORT 📉');
  const longWins = longTrades.filter(s => s.status === 'WIN').length;
  const shortWins = shortTrades.filter(s => s.status === 'WIN').length;
  const longWinRate = longTrades.length ? (longWins / longTrades.length * 100).toFixed(1) : 0;
  const shortWinRate = shortTrades.length ? (shortWins / shortTrades.length * 100).toFixed(1) : 0;

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TRADING AI PRO V10.0 - Dashboard</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 100%);color:#fff;padding:20px}
      .container{max-width:1400px;margin:0 auto}
      h1{text-align:center;margin-bottom:20px;font-size:2em;background:linear-gradient(135deg,#00b4d8,#90e0ef);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .subtitle{text-align:center;color:#888;margin-bottom:30px;font-size:14px}
      .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:15px;margin-bottom:30px}
      .stat-card{background:rgba(255,255,255,0.08);border-radius:12px;padding:15px;text-align:center;backdrop-filter:blur(10px)}
      .stat-card h3{font-size:11px;opacity:0.7;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px}
      .stat-card .value{font-size:26px;font-weight:bold}
      .stat-card .value.profit{color:#00ff88}
      .stat-card .value.loss{color:#ff4444}
      .stat-card .value.gold{color:#ffd700}
      .stat-card .value.blue{color:#00b4d8}
      .grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;margin-bottom:30px}
      .card{background:rgba(255,255,255,0.05);border-radius:12px;padding:20px}
      .card h3{color:#00b4d8;margin-bottom:15px;font-size:16px}
      table{width:100%;border-collapse:collapse}
      th,td{padding:10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.05)}
      th{color:#00b4d8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px}
      td{font-size:13px}
      .status-win{color:#00ff88}
      .status-loss{color:#ff4444}
      .status-open{color:#ffaa00}
      .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:bold}
      .badge-win{background:rgba(0,255,136,0.2);color:#00ff88}
      .badge-loss{background:rgba(255,68,68,0.2);color:#ff4444}
      .badge-open{background:rgba(255,170,0,0.2);color:#ffaa00}
      .footer{text-align:center;color:#555;font-size:11px;margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.05)}
      @media(max-width:768px){.stats-grid{grid-template-columns:repeat(3,1fr)}.grid-2{grid-template-columns:1fr}}
      @media(max-width:500px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
    </style>
  </head>
  <body>
    <div class="container">
      <h1>🏆 TRADING AI PRO V10.0</h1>
      <div class="subtitle">Institutional Ultimate Edition - Smart Money Concept</div>
      
      <div class="stats-grid">
        <div class="stat-card"><h3>📊 إجمالي</h3><div class="value gold">${history.length + activeSignals.length}</div></div>
        <div class="stat-card"><h3>✅ الرابحة</h3><div class="value profit">${wins}</div></div>
        <div class="stat-card"><h3>❌ الخاسرة</h3><div class="value loss">${losses}</div></div>
        <div class="stat-card"><h3>📈 نسبة النجاح</h3><div class="value gold">${winRate}%</div></div>
        <div class="stat-card"><h3>💰 الأرباح</h3><div class="value ${totalProfit >= 0 ? 'profit' : 'loss'}">${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}%</div></div>
        <div class="stat-card"><h3>⚡ نشطة</h3><div class="value blue">${activeSignals.length}</div></div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card"><h3>🟢 LONG %</h3><div class="value profit">${longWinRate}%</div></div>
        <div class="stat-card"><h3>🔴 SHORT %</h3><div class="value profit">${shortWinRate}%</div></div>
        <div class="stat-card"><h3>🎯 Profit Factor</h3><div class="value gold">${(riskMetrics.profitFactor || 0).toFixed(2)}</div></div>
        <div class="stat-card"><h3>💰 Expectancy</h3><div class="value ${(riskMetrics.expectancy || 0) >= 0 ? 'profit' : 'loss'}">${(riskMetrics.expectancy || 0).toFixed(2)}</div></div>
        <div class="stat-card"><h3>⏰ أفضل وقت</h3><div class="value gold">${bestTime !== null ? bestTime + ':00' : 'N/A'}</div></div>
        <div class="stat-card"><h3>📅 أفضل يوم</h3><div class="value gold">${bestDay}</div></div>
      </div>
      
      <div class="grid-2">
        <div class="card">
          <h3>🏆 أفضل 5 عملات</h3>
          <table>
            <thead><tr><th>العملة</th><th>الصفقات</th><th>نسبة النجاح</th><th>الربح</th></tr></thead>
            <tbody>
              ${topCoins.map(([coin, data]) => `
                <tr>
                  <td><strong>${coin}</strong></td>
                  <td>${data.total}</td>
                  <td class="${(data.wins/data.total*100) >= 50 ? 'status-win' : 'status-loss'}">${(data.wins/data.total*100).toFixed(1)}%</td>
                  <td class="${data.profit >= 0 ? 'status-win' : 'status-loss'}">${data.profit >= 0 ? '+' : ''}${data.profit.toFixed(1)}%</td>
                </tr>
              `).join('')}
              ${topCoins.length === 0 ? '<tr><td colspan="4">لا توجد بيانات كافية</td></tr>' : ''}
            </tbody>
          </table>
        </div>
        
        <div class="card">
          <h3>⚡ الإشارات النشطة</h3>
          <table>
            <thead><tr><th>العملة</th><th>النوع</th><th>الدخول</th><th>TP1</th><th>TP2</th><th>TP3</th><th>SL</th></tr></thead>
            <tbody>
              ${activeSignals.map(s => `
                <tr>
                  <td><strong>${s.coin}</strong></td>
                  <td>${s.side}</td>
                  <td>$${s.entry?.toFixed(6)}</td>
                  <td>$${s.tp1?.toFixed(6)}</td>
                  <td>$${s.tp2?.toFixed(6)}</td>
                  <td>$${s.tp3?.toFixed(6)}</td>
                  <td>$${s.sl?.toFixed(6)}</td>
                </tr>
              `).join('')}
              ${activeSignals.length === 0 ? '<tr><td colspan="7">لا توجد إشارات نشطة</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
      
      <div class="footer">
        V10.0 Institutional Ultimate Edition | Powered by SMC/ICT
      </div>
    </div>
  </body>
  </html>`;
}

// ======================= 15. الأوامر والقوائم =======================

const MENU = {
  inline_keyboard: [
    [{ text: "🚀 أفضل الصاعدين", callback_data: "top" }, { text: "💰 سعر BTC", callback_data: "btc" }],
    [{ text: "🎭 مؤشر الخوف", callback_data: "fear" }, { text: "⚡ إشاراتي", callback_data: "my_signals" }],
    [{ text: "📊 Dashboard", callback_data: "dashboard" }, { text: "🔓 التحقق", callback_data: "check_sub" }],
    [{ text: "🔄 فحص فوري", callback_data: "scan" }]
  ]
};

async function fetchTopMovers() {
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

async function getFearIndex() {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    const d = await res.json();
    return { val: d.data[0].value, cls: d.data[0].value_classification };
  } catch { return { val: 50, cls: "محايد" }; }
}

async function isUserSubscribed(userId) {
  try {
    const token = env?.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${REQUIRED_CHANNEL}&user_id=${userId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok && data.result) {
      return ['creator', 'administrator', 'member'].includes(data.result.status);
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ======================= 16. الـ Handler الرئيسي =======================

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(institutionalScanner(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env.SIGNALS_KV;

    // ✅ Dashboard
    if (url.pathname === '/dashboard' || url.pathname === '/') {
      const active = kv ? JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]') : [];
      const history = kv ? JSON.parse(await kv.get('HISTORY_SIGNALS') || '[]') : [];
      const learningSystem = new InstitutionalLearningSystem(kv);
      await learningSystem.initialize();
      return new Response(getDashboardHTML(active, history, learningSystem), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ✅ API Stats
    if (url.pathname === '/api/stats') {
      const history = kv ? JSON.parse(await kv.get('HISTORY_SIGNALS') || '[]') : [];
      const active = kv ? JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]') : [];
      const wins = history.filter(s => s.status === 'WIN').length;
      const losses = history.filter(s => s.status === 'LOSS').length;
      const totalProfit = history.reduce((sum, s) => sum + (s.finalProfit || 0), 0);
      return new Response(JSON.stringify({
        totalSignals: history.length + active.length,
        wins,
        losses,
        winRate: history.length ? ((wins / history.length) * 100).toFixed(1) : 0,
        totalProfit: totalProfit.toFixed(2),
        activeSignals: active.length,
        version: 'V10.0 Institutional Ultimate'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ✅ Scan يدوي
    if (url.pathname === '/scan') {
      ctx.waitUntil(institutionalScanner(env));
      return new Response('🔍 Institutional V10.0 Scanning...', { status: 200 });
    }

    // ✅ Webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        // ✅ Callback Query
        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data;
          const userId = cb.from.id;
          const isSubscribed = await isUserSubscribed(userId);

          if (data === 'check_sub') {
            if (isSubscribed) {
              await sendTelegram(cb.message.chat.id,
                `✅ *تم التحقق من اشتراكك!*\n\nأنت مشترك في القناة ${REQUIRED_CHANNEL}\nيمكنك استخدام جميع ميزات البوت.`
              );
            } else {
              const subMsg = `🔴 *عذراً، أنت غير مشترك في القناة!*\n\n🔒 يجب الاشتراك في قناتنا أولاً:\n👉 ${REQUIRED_CHANNEL}\n\nبعد الاشتراك، ارسل /start مرة أخرى.`;
              const subKeyboard = {
                inline_keyboard: [[{ text: "📢 انضم للقناة", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]]
              };
              await sendTelegram(cb.message.chat.id, subMsg, subKeyboard);
            }
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              body: JSON.stringify({ callback_query_id: cb.id })
            });
            return new Response('OK');
          }

          if (!isSubscribed) {
            const subMsg = `🔴 *الاشتراك مطلوب!*\n\nيرجى الاشتراك في قناتنا أولاً:\n👉 ${REQUIRED_CHANNEL}\n\nثم ارسل /start مرة أخرى.`;
            const subKeyboard = {
              inline_keyboard: [[{ text: "📢 انضم للقناة", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]]
            };
            await sendTelegram(cb.message.chat.id, subMsg, subKeyboard);
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
              method: 'POST',
              body: JSON.stringify({ callback_query_id: cb.id })
            });
            return new Response('OK');
          }

          if (data === 'scan') {
            ctx.waitUntil(institutionalScanner(env));
            await sendTelegram(cb.message.chat.id, '🔍 *جاري الفحص المؤسسي V10.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.');
          } else if (data === 'top') {
            const movers = await fetchTopMovers();
            await sendTelegram(cb.message.chat.id,
              `🚀 *أفضل الصاعدين*\n${movers.map(x => `🟢 ${x.s}: +${x.c.toFixed(2)}%`).join('\n')}`
            );
          } else if (data === 'fear') {
            const fear = await getFearIndex();
            await sendTelegram(cb.message.chat.id,
              `🎭 *مؤشر الخوف*\nالقيمة: ${fear.val}/100\nالحالة: ${fear.cls}`
            );
          } else if (data === 'btc') {
            const btc = await getData('BTCUSDT', '15m', 1);
            if (btc) await sendTelegram(cb.message.chat.id,
              `💰 *BTC/USDT*\n$${btc[0].close.toLocaleString()}`
            );
          } else if (data === 'dashboard') {
            await sendTelegram(cb.message.chat.id,
              `📊 *Dashboard V10.0*\nhttps://${url.hostname}/dashboard`
            );
          } else if (data === 'my_signals') {
            let active = kv ? JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]') : [];
            if (active.length === 0) {
              await sendTelegram(cb.message.chat.id, '📭 لا توجد إشارات نشطة');
            } else {
              let msg = `⚡ *إشاراتي النشطة (${active.length})*\n━━━━━━━━━━━━━━━━━\n`;
              active.forEach(s => {
                msg += `\n🪙 *${s.coin}* | ${s.side}\n💰 $${s.entry?.toFixed(8)}\n🎯 TP1: $${s.tp1?.toFixed(8)}\n🎯 TP2: $${s.tp2?.toFixed(8)}\n🎯 TP3: $${s.tp3?.toFixed(8)}\n🛑 SL: $${s.sl?.toFixed(8)}\n`;
              });
              await sendTelegram(cb.message.chat.id, msg);
            }
          }

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            body: JSON.stringify({ callback_query_id: cb.id })
          });
          return new Response('OK');
        }

        // ✅ الرسائل
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();
          const userId = update.message.from.id;
          const isSubscribed = await isUserSubscribed(userId);

          if (text === '/start') {
            if (!isSubscribed) {
              const startMsg = `🤖 *TRADING AI PRO V10.0*\n━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ *الاشتراك مطلوب للاستخدام!*\n\nيرجى الاشتراك في قناتنا أولاً:\n👉 ${REQUIRED_CHANNEL}\n\nبعد الاشتراك، ارسل /start مرة أخرى للتحقق.`;
              const subKeyboard = {
                inline_keyboard: [[{ text: "📢 انضم للقناة", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]]
              };
              await sendTelegram(chatId, startMsg, subKeyboard);
            } else {
              await sendTelegram(chatId,
                `🤖 *TRADING AI PRO V10.0* 🔐\n━━━━━━━━━━━━━━━━━━━━━\n✅ *اشتراكك نشط* ✅\n\n🔹 *المميزات:*\n✅ Institutional SMC\n✅ Daily Bias متقدم\n✅ Order Block + FVG + Sweep\n✅ SMT Divergence\n✅ VWAP + Volume Profile\n✅ CVD + Footprint\n✅ نظام تعلم ذاتي\n✅ Dashboard متطور\n\n📊 Dashboard: https://${url.hostname}/dashboard\n\nاختر من القائمة:`, MENU
              );
            }
          } else if (!isSubscribed) {
            const subMsg = `🔴 *الاشتراك مطلوب!*\n\nيرجى الاشتراك في قناتنا أولاً:\n👉 ${REQUIRED_CHANNEL}\n\nثم ارسل /start مرة أخرى.`;
            const subKeyboard = {
              inline_keyboard: [[{ text: "📢 انضم للقناة", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]]
            };
            await sendTelegram(chatId, subMsg, subKeyboard);
          } else if (text === '/menu') {
            await sendTelegram(chatId, '📋 *القائمة الرئيسية*\nاختر أحد الخيارات:', MENU);
          } else if (text === '/scan') {
            ctx.waitUntil(institutionalScanner(env));
            await sendTelegram(chatId, '🔍 *جاري الفحص المؤسسي V10.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.');
          } else {
            await sendTelegram(chatId, `📋 استخدم /start للقائمة الرئيسية\n📊 Dashboard: https://${url.hostname}/dashboard`);
          }
        }

      } catch (e) {
        console.error('Webhook error:', e);
      }
      return new Response('OK');
    }

    return new Response('404', { status: 404 });
  }
};
