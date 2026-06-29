// ============================================================
// 🏆 TRADING AI PRO V11.0 - INSTITUTIONAL ULTIMATE EDITION
// Smart Money Concept | ICT | Crypto Trading | Multi-Exchange
// ============================================================

// ======================= 1. الإعدادات الأساسية =======================

const REQUIRED_CHANNEL = '@mrcrypto166';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 12,
  MIN_RISK_REWARD: 2.5,
  SCORE_STRONG: 95,
  SCORE_BUY: 88,
  SCORE_WATCH: 75,
  COOLDOWN_HOURS: 3,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 3.5],
  CACHE_TTL_MS: 300000,
  BATCH_SIZE: 3,
  DELAY: 500,
  
  EXCHANGES: {
    BINANCE: {
      name: 'Binance',
      baseUrl: 'https://api.binance.com',
      priority: 1,
      minVolume: 10000000,
      enabled: true
    },
    BYBIT: {
      name: 'Bybit',
      baseUrl: 'https://api.bybit.com',
      priority: 2,
      minVolume: 5000000,
      enabled: true
    }
  },
  
  RECOMMENDATIONS: {
    MAX_PER_SCAN: 5,
    MIN_CONFIDENCE: 70,
    MIN_HTF_ALIGNMENT: 0.8,
    MIN_SENTIMENT_SCORE: 60
  },
  
  RISK: {
    MAX_POSITION_SIZE_PERCENT: 20,
    MAX_DAILY_LOSS_PERCENT: 5,
    MAX_CONSECUTIVE_LOSSES: 3,
    MIN_RISK_REWARD: 2.5,
    TRAILING_STOP_ACTIVATION: 1.5,
    TRAILING_STOP_DISTANCE: 0.5
  },
  
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

// ======================= 2. القوائم =======================

const INSTITUTIONAL_WATCH_LIST = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC',
  'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR', 'APT', 'SUI', 'ARB', 'OP', 'SEI',
  'INJ', 'RNDR', 'FET', 'AGIX', 'OCEAN', 'DOGE', 'SHIB', 'PEPE', 'WIF', 'FLOKI',
  'MNT', 'VET', 'ICP', 'FIL', 'ETC', 'AAVE', 'MKR', 'CRV', 'SUSHI', 'CAKE',
  'GALA', 'SAND', 'MANA', 'AXS', 'FLOW', 'EOS', 'NEO', 'XLM', 'ALGO', 'HBAR'
];

const STABLE_COINS_BLACKLIST = [
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDD', 'FRAX', 'LUSD', 'GUSD'
];

// ======================= 3. المتغيرات العامة =======================

let dataCache = new Map();
let fundingCache = new Map();
let oiCache = new Map();
let btcCache = null;
let btcCacheTime = 0;
let lastSend = 0;
let messageQueue = [];
let isProcessingQueue = false;

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

  // حساب OBV
  static calculateOBV(data) {
    let obv = 0;
    const values = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i].close > data[i-1].close) obv += data[i].vol;
      else if (data[i].close < data[i-1].close) obv -= data[i].vol;
      values.push(obv);
    }
    return obv;
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
          const isMitigated = data.slice(i + 3).some(c => c.close <= c1.low && c >= c3.high);
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

// ======================= 9. تحليل HTF =======================

class HTFAnalyzer {
  static analyze(dataDaily, data4h, data1h) {
    const dailyTrend = this.getTrend(dataDaily);
    const h4Trend = this.getTrend(data4h);
    const h1Trend = this.getTrend(data1h);
    
    const alignment = (dailyTrend === h4Trend && h4Trend === h1Trend);
    
    let strength = 0;
    if (dailyTrend === 'UP') strength += 0.4;
    if (h4Trend === 'UP') strength += 0.35;
    if (h1Trend === 'UP') strength += 0.25;
    
    return {
      dailyTrend,
      h4Trend,
      h1Trend,
      alignment,
      strength: Math.min(strength, 1),
      direction: strength > 0.6 ? 'BULLISH' : strength < 0.4 ? 'BEARISH' : 'NEUTRAL'
    };
  }

  static getTrend(data) {
    if (!data || data.length < 50) return 'NEUTRAL';
    
    const closes = data.map(d => d.close);
    const ema20 = AdvancedIndicators.ema(closes, 20);
    const ema50 = AdvancedIndicators.ema(closes, 50);
    const currentPrice = closes[closes.length - 1];
    
    if (currentPrice > ema20 && ema20 > ema50) return 'UP';
    if (currentPrice < ema20 && ema20 < ema50) return 'DOWN';
    
    return 'NEUTRAL';
  }
}

// ======================= 10. تحليل المشاعر =======================

class SentimentAnalyzer {
  static async analyze(symbol, exchange = 'Binance') {
    try {
      const [funding, oi, ticker] = await Promise.all([
        this.getFundingRate(symbol, exchange),
        this.getOpenInterest(symbol, exchange),
        this.getTicker(symbol, exchange)
      ]);
      
      let sentiment = 50;
      let factors = [];
      
      if (funding !== null) {
        if (funding < -0.0005) {
          sentiment += 15;
          factors.push('Funding Rate منخفض (Bullish)');
        } else if (funding > 0.0005) {
          sentiment -= 15;
          factors.push('Funding Rate مرتفع (Bearish)');
        }
      }
      
      if (oi !== null) {
        const avgOI = await this.getAvgOI(symbol, exchange);
        if (avgOI && oi > avgOI * 1.2) {
          sentiment += 10;
          factors.push('OI مرتفع (نشاط قوي)');
        } else if (avgOI && oi < avgOI * 0.8) {
          sentiment -= 5;
          factors.push('OI منخفض (ضعف)');
        }
      }
      
      if (ticker) {
        if (ticker.change24h > 5) sentiment += 10;
        else if (ticker.change24h < -5) sentiment -= 10;
        factors.push(`تغير 24h: ${ticker.change24h.toFixed(2)}%`);
      }
      
      sentiment = Math.min(Math.max(sentiment, 0), 100);
      
      return {
        score: sentiment,
        bias: sentiment > 60 ? 'BULLISH' : sentiment < 40 ? 'BEARISH' : 'NEUTRAL',
        level: sentiment > 70 ? 'EXTREME_BULLISH' : sentiment < 30 ? 'EXTREME_BEARISH' : 'NORMAL',
        factors,
        confidence: Math.abs(sentiment - 50) / 50
      };
    } catch (e) {
      return { score: 50, bias: 'NEUTRAL', level: 'NORMAL', factors: [], confidence: 0 };
    }
  }

  static async getFundingRate(symbol, exchange) {
    try {
      if (exchange === 'Binance') {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
        if (!res.ok) return null;
        const data = await res.json();
        return +data.lastFundingRate;
      } else if (exchange === 'Bybit') {
        const res = await fetch(`${CONFIG.EXCHANGES.BYBIT.baseUrl}/v5/market/tickers?category=linear&symbol=${symbol}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.retCode !== 0 || !data.result?.list?.[0]) return null;
        return +data.result.list[0].fundingRate;
      }
    } catch { return null; }
    return null;
  }

  static async getOpenInterest(symbol, exchange) {
    try {
      if (exchange === 'Binance') {
        const res = await fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=1`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || data.length === 0) return null;
        return +data[0].sumOpenInterest;
      } else if (exchange === 'Bybit') {
        const res = await fetch(`${CONFIG.EXCHANGES.BYBIT.baseUrl}/v5/market/open-interest?category=linear&symbol=${symbol}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.retCode !== 0 || !data.result?.list?.[0]) return null;
        return +data.result.list[0].openInterest;
      }
    } catch { return null; }
    return null;
  }

  static async getTicker(symbol, exchange) {
    try {
      if (exchange === 'Binance') {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
        if (!res.ok) return null;
        const data = await res.json();
        return {
          price: +data.lastPrice,
          volume24h: +data.quoteVolume,
          change24h: +data.priceChangePercent,
          high: +data.highPrice,
          low: +data.lowPrice
        };
      } else if (exchange === 'Bybit') {
        const res = await fetch(`${CONFIG.EXCHANGES.BYBIT.baseUrl}/v5/market/tickers?category=spot&symbol=${symbol}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.retCode !== 0 || !data.result?.list?.[0]) return null;
        const ticker = data.result.list[0];
        return {
          price: +ticker.lastPrice,
          volume24h: +ticker.volume24h,
          change24h: +ticker.price24hPcnt * 100,
          high: +ticker.highPrice24h,
          low: +ticker.lowPrice24h
        };
      }
    } catch { return null; }
    return null;
  }

  static async getAvgOI(symbol, exchange) {
    try {
      const history = [];
      for (let i = 0; i < 5; i++) {
        const oi = await this.getOpenInterest(symbol, exchange);
        if (oi) history.push(oi);
        await delay(100);
      }
      if (history.length === 0) return null;
      return history.reduce((a, b) => a + b, 0) / history.length;
    } catch { return null; }
  }
}

// ======================= 11. نظام إدارة المخاطر =======================

class AdvancedRiskManager {
  constructor(kv) {
    this.kv = kv;
    this.accountBalance = 10000;
    this.dailyLoss = 0;
    this.consecutiveLosses = 0;
  }

  async initialize() {
    const data = await this.kv?.get('RISK_DATA');
    if (data) {
      const parsed = JSON.parse(data);
      this.accountBalance = parsed.balance || 10000;
      this.dailyLoss = parsed.dailyLoss || 0;
      this.consecutiveLosses = parsed.consecutiveLosses || 0;
      
      const lastReset = parsed.lastReset || 0;
      if (Date.now() - lastReset > 24 * 60 * 60 * 1000) {
        this.dailyLoss = 0;
        this.consecutiveLosses = 0;
        await this.save();
      }
    }
  }

  async save() {
    await this.kv?.put('RISK_DATA', JSON.stringify({
      balance: this.accountBalance,
      dailyLoss: this.dailyLoss,
      consecutiveLosses: this.consecutiveLosses,
      lastReset: Date.now()
    }));
  }

  calculatePositionSize(entryPrice, stopLoss, riskPercent = 2) {
    const riskAmount = this.accountBalance * (riskPercent / 100);
    const slDistance = Math.abs(entryPrice - stopLoss) / entryPrice;
    
    if (slDistance === 0) return 0;
    
    const positionSize = riskAmount / slDistance / entryPrice;
    const maxPosition = this.accountBalance * (CONFIG.RISK.MAX_POSITION_SIZE_PERCENT / 100) / entryPrice;
    
    return Math.min(positionSize, maxPosition);
  }

  async updateAfterTrade(trade) {
    if (trade.result === 'WIN') {
      this.accountBalance += trade.profit;
      this.consecutiveLosses = 0;
    } else {
      this.accountBalance += trade.profit;
      this.dailyLoss += Math.abs(trade.profit);
      this.consecutiveLosses++;
    }
    
    await this.save();
  }

  canTrade() {
    const dailyLossPercent = (this.dailyLoss / this.accountBalance) * 100;
    if (dailyLossPercent >= CONFIG.RISK.MAX_DAILY_LOSS_PERCENT) {
      return { allowed: false, reason: 'الحد اليومي للخسارة تم تجاوزه' };
    }
    
    if (this.consecutiveLosses >= CONFIG.RISK.MAX_CONSECUTIVE_LOSSES) {
      return { allowed: false, reason: '3 خسائر متتالية - توقف مؤقت' };
    }
    
    return { allowed: true, reason: 'OK' };
  }

  calculateTrailingStop(entry, current, high, side, profitPercent) {
    if (profitPercent < CONFIG.RISK.TRAILING_STOP_ACTIVATION) {
      return null;
    }
    
    const trailDistance = CONFIG.RISK.TRAILING_STOP_DISTANCE / 100;
    
    if (side === 'LONG') {
      const highest = Math.max(entry, high);
      return highest * (1 - trailDistance);
    } else {
      const lowest = Math.min(entry, high);
      return lowest * (1 + trailDistance);
    }
  }
}

// ======================= 12. نظام التوصيات المتقدم =======================

class AdvancedRecommendationSystem {
  static filterRecommendations(signals) {
    let filtered = signals.filter(s => s.score >= CONFIG.RECOMMENDATIONS.MIN_CONFIDENCE);
    filtered = filtered.filter(s => s.htfAlignment >= CONFIG.RECOMMENDATIONS.MIN_HTF_ALIGNMENT);
    filtered = filtered.filter(s => s.sentimentScore >= CONFIG.RECOMMENDATIONS.MIN_SENTIMENT_SCORE);
    filtered.sort((a, b) => b.priorityScore - a.priorityScore);
    return filtered.slice(0, CONFIG.RECOMMENDATIONS.MAX_PER_SCAN);
  }
  
  static calculatePriorityScore(signal) {
    let score = 0;
    score += signal.smcScore * 0.4;
    if (signal.dailyBias === signal.direction) score += 20;
    score += signal.htfAlignment * 15;
    score += (signal.sentimentScore / 100) * 15;
    score += Math.min(signal.rr / 5, 1) * 10;
    return Math.min(score, 100);
  }
}

// ======================= 13. Multi-Exchange Data =======================

class MultiExchangeData {
  static async getData(symbol, interval = '15m', limit = 200) {
    let data = await this.getBinanceData(symbol, interval, limit);
    if (data) return data;
    data = await this.getBybitData(symbol, interval, limit);
    if (data) return data;
    return null;
  }

  static async getBinanceData(symbol, interval = '15m', limit = 200) {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.map(c => ({
        time: new Date(c[0]),
        open: +c[1],
        high: +c[2],
        low: +c[3],
        close: +c[4],
        vol: +c[5],
        exchange: 'Binance'
      }));
    } catch { return null; }
  }

  static async getBybitData(symbol, interval = '15m', limit = 200) {
    try {
      const intervalMap = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D' };
      const bybitInterval = intervalMap[interval] || '15';
      
      const res = await fetch(`${CONFIG.EXCHANGES.BYBIT.baseUrl}/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.retCode !== 0 || !data.result?.list) return null;
      
      return data.result.list.map(c => ({
        time: new Date(parseInt(c[0])),
        open: +c[1],
        high: +c[2],
        low: +c[3],
        close: +c[4],
        vol: +c[5],
        exchange: 'Bybit'
      }));
    } catch { return null; }
  }
}

// ======================= 14. التقييم المتقدم =======================

class EnhancedInstitutionalScoring {
  static async calculateScore(coin, data15m, data1h, data4h, dataDaily, currentPrice, btcBullish, btcData, ethData, intendedDirection, learningSystem, exchange = 'Binance') {
    const smcScore = await this.calculateSMCScore(coin, data15m, currentPrice, intendedDirection);
    const htfAnalysis = HTFAnalyzer.analyze(dataDaily, data4h, data1h);
    const htfScore = htfAnalysis.strength * 100;
    const htfAlignment = htfAnalysis.alignment ? 1 : 0.5;
    
    const dailyBias = await AdvancedDailyBias.analyze(coin + 'USDT', dataDaily, data4h, data1h, btcData, ethData);
    const sentiment = await SentimentAnalyzer.analyze(coin + 'USDT', exchange);
    
    const rr = await this.calculateRR(data15m, currentPrice, intendedDirection);
    const rrScore = Math.min((rr / CONFIG.MIN_RISK_REWARD) * 100, 100);
    
    let finalScore = 0;
    const weights = { smc: 0.35, htf: 0.20, dailyBias: 0.20, sentiment: 0.15, riskReward: 0.10 };
    
    finalScore += smcScore.score * weights.smc;
    finalScore += htfScore * weights.htf;
    
    if (dailyBias.bias === intendedDirection) finalScore += 100 * weights.dailyBias;
    else if (dailyBias.bias === 'NEUTRAL') finalScore += 50 * weights.dailyBias;
    
    finalScore += sentiment.score * weights.sentiment;
    finalScore += rrScore * weights.riskReward;
    
    finalScore = Math.min(Math.max(finalScore, 0), 100);
    
    return {
      score: finalScore,
      smcScore: smcScore.score,
      htfScore: htfScore,
      dailyBias: dailyBias.bias,
      dailyBiasConfidence: dailyBias.confidence,
      sentimentScore: sentiment.score,
      sentimentBias: sentiment.bias,
      htfAlignment,
      rr,
      reasons: [
        ...smcScore.reasons,
        `HTF: ${htfAnalysis.direction} (${(htfScore).toFixed(0)}%)`,
        `Sentiment: ${sentiment.bias} (${sentiment.score.toFixed(0)})`,
        `Daily Bias: ${dailyBias.bias} (${(dailyBias.confidence * 100).toFixed(0)}%)`
      ]
    };
  }

  static async calculateSMCScore(coin, data15m, currentPrice, intendedDirection) {
    let score = 0;
    const reasons = [];
    
    const { bos, choch } = AdvancedSMC.detectBOS_CHOCH(data15m);
    
    if (bos && bos.type === 'BULLISH' && intendedDirection === 'LONG') {
      score += 15 * Math.min(bos.strength, 1.5);
      reasons.push(`🚀 BOS صاعد (+${(15 * Math.min(bos.strength, 1.5)).toFixed(0)})`);
    }
    if (bos && bos.type === 'BEARISH' && intendedDirection === 'SHORT') {
      score += 15 * Math.min(bos.strength, 1.5);
      reasons.push(`📉 BOS هابط (+${(15 * Math.min(bos.strength, 1.5)).toFixed(0)})`);
    }
    
    if (choch && choch.type === 'BULLISH' && intendedDirection === 'LONG') {
      score += 10 * Math.min(choch.strength, 1.5);
      reasons.push(`🔄 CHoCH صاعد (+${(10 * Math.min(choch.strength, 1.5)).toFixed(0)})`);
    }
    if (choch && choch.type === 'BEARISH' && intendedDirection === 'SHORT') {
      score += 10 * Math.min(choch.strength, 1.5);
      reasons.push(`🔄 CHoCH هابط (+${(10 * Math.min(choch.strength, 1.5)).toFixed(0)})`);
    }
    
    const fvg = AdvancedSMC.detectFVG(data15m);
    if (fvg && fvg.type === 'BULLISH' && intendedDirection === 'LONG' && !fvg.isMitigated) {
      score += 10 * fvg.strength;
      reasons.push(`📊 FVG صاعد (+${(10 * fvg.strength).toFixed(0)})`);
    }
    if (fvg && fvg.type === 'BEARISH' && intendedDirection === 'SHORT' && !fvg.isMitigated) {
      score += 10 * fvg.strength;
      reasons.push(`📊 FVG هابط (+${(10 * fvg.strength).toFixed(0)})`);
    }
    
    const ob = AdvancedSMC.detectOrderBlock(data15m);
    if (ob && ob.type === 'BULLISH' && intendedDirection === 'LONG' && !ob.isMitigated) {
      score += 10 * ob.strength / 3;
      reasons.push(`🏛️ OB صاعد (+${(10 * ob.strength / 3).toFixed(0)})`);
    }
    if (ob && ob.type === 'BEARISH' && intendedDirection === 'SHORT' && !ob.isMitigated) {
      score += 10 * ob.strength / 3;
      reasons.push(`🏛️ OB هابط (+${(10 * ob.strength / 3).toFixed(0)})`);
    }
    
    const liquidity = AdvancedSMC.detectLiquidity(data15m);
    if (liquidity.hasSweep && liquidity.strongestSweep) {
      const sweep = liquidity.strongestSweep;
      if (sweep.type === 'BUY' && intendedDirection === 'LONG') {
        score += 15 * sweep.strength;
        reasons.push(`🦅 Sweep صاعد (+${(15 * sweep.strength).toFixed(0)})`);
      }
      if (sweep.type === 'SELL' && intendedDirection === 'SHORT') {
        score += 15 * sweep.strength;
        reasons.push(`🦅 Sweep هابط (+${(15 * sweep.strength).toFixed(0)})`);
      }
    }
    
    return { score: Math.min(score, 100), reasons };
  }

  static async calculateRR(data, currentPrice, direction) {
    const atr = AdvancedIndicators.calculateATR(data);
    if (!atr || atr === 0) return 0;
    
    if (direction === 'LONG') {
      const tp = currentPrice + (atr * 3);
      const sl = currentPrice - atr;
      return (tp - currentPrice) / (currentPrice - sl);
    } else {
      const tp = currentPrice - (atr * 3);
      const sl = currentPrice + atr;
      return (currentPrice - tp) / (sl - currentPrice);
    }
  }
}

// ======================= 15. معالجة العملات المطورة =======================

async function processCoinEnhanced(coin, kv, btcBullish, btcData, ethData, direction, learningSystem, riskManager, exchange) {
  try {
    const symbol = coin + 'USDT';
    
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return null;
    
    const [data5m, data15m, data1h, data4h, dataDaily] = await Promise.all([
      MultiExchangeData.getData(symbol, '5m', 100),
      MultiExchangeData.getData(symbol, '15m', 200),
      MultiExchangeData.getData(symbol, '1h', 200),
      MultiExchangeData.getData(symbol, '4h', 100),
      MultiExchangeData.getData(symbol, '1d', 30)
    ]);
    
    if (!data15m) return null;
    
    const currentPrice = data15m[data15m.length - 1].close;
    
    const score = await EnhancedInstitutionalScoring.calculateScore(
      coin, data15m, data1h, data4h, dataDaily,
      currentPrice, btcBullish, btcData, ethData,
      direction, learningSystem, exchange
    );
    
    if (score.score < CONFIG.RECOMMENDATIONS.MIN_CONFIDENCE) return null;
    if (score.rr < CONFIG.MIN_RISK_REWARD) return null;
    
    const atr = AdvancedIndicators.calculateATR(data15m);
    const { tp1, tp2, tp3, sl } = calculateLevels(currentPrice, atr, direction);
    
    const positionSize = riskManager.calculatePositionSize(currentPrice, sl, 2);
    
    return {
      coin,
      symbol,
      exchange,
      direction,
      entry: currentPrice,
      tp1, tp2, tp3, sl,
      positionSize,
      score: score.score,
      smcScore: score.smcScore,
      rr: score.rr,
      dailyBias: score.dailyBias,
      sentimentScore: score.sentimentScore,
      htfAlignment: score.htfAlignment,
      priorityScore: AdvancedRecommendationSystem.calculatePriorityScore({...score, direction, rr: score.rr}),
      reasons: score.reasons,
      timestamp: Date.now()
    };
    
  } catch (e) {
    console.error(`Error ${coin} (${exchange}):`, e);
    return null;
  }
}

function calculateLevels(price, atr, direction) {
  if (atr && atr > 0) {
    if (direction === 'LONG') {
      return {
        tp1: price + (atr * CONFIG.TP_ATR_MULTIPLIER[0]),
        tp2: price + (atr * CONFIG.TP_ATR_MULTIPLIER[1]),
        tp3: price + (atr * CONFIG.TP_ATR_MULTIPLIER[2]),
        sl: price - (atr * 1)
      };
    } else {
      return {
        tp1: price - (atr * CONFIG.TP_ATR_MULTIPLIER[0]),
        tp2: price - (atr * CONFIG.TP_ATR_MULTIPLIER[1]),
        tp3: price - (atr * CONFIG.TP_ATR_MULTIPLIER[2]),
        sl: price + (atr * 1)
      };
    }
  } else {
    if (direction === 'LONG') {
      return {
        tp1: price * 1.03,
        tp2: price * 1.06,
        tp3: price * 1.10,
        sl: price * 0.97
      };
    } else {
      return {
        tp1: price * 0.97,
        tp2: price * 0.94,
        tp3: price * 0.90,
        sl: price * 1.03
      };
    }
  }
}

// ======================= 16. إرسال التوصيات =======================

async function sendEnhancedSignal(signal) {
  const emoji = signal.score >= 95 ? '🟢' : signal.score >= 88 ? '🟡' : '🔵';
  const type = signal.score >= 95 ? 'STRONG BUY' : signal.score >= 88 ? 'BUY' : 'WATCHLIST';
  
  let msg = `${emoji} *${type} - ${signal.score}%* ${emoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🪙 *${signal.coin}/USDT* (${signal.exchange})\n`;
  msg += `🎯 *${signal.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
  msg += `💰 *$${signal.entry.toFixed(8)}*\n\n`;
  msg += `📊 *R/R: 1:${signal.rr.toFixed(2)}*\n`;
  msg += `🎯 TP1: *$${signal.tp1.toFixed(8)}*\n`;
  msg += `🎯 TP2: *$${signal.tp2.toFixed(8)}*\n`;
  msg += `🎯 TP3: *$${signal.tp3.toFixed(8)}*\n`;
  msg += `🛑 SL: *$${signal.sl.toFixed(8)}*\n\n`;
  msg += `📌 *الأسباب:*\n`;
  msg += `${signal.reasons.slice(0, 6).join("\n")}\n\n`;
  msg += `📈 Daily Bias: ${signal.dailyBias}\n`;
  msg += `💭 Sentiment: ${signal.sentimentScore.toFixed(0)}%\n`;
  msg += `🔄 HTF Alignment: ${signal.htfAlignment > 0.7 ? '✅' : '⚠️'}\n`;
  msg += `📊 الأولوية: ${signal.priorityScore.toFixed(0)}%\n`;
  msg += `⚡ *V11.0 Multi-Exchange Ultimate*`;
  
  await sendTelegram(REQUIRED_CHANNEL, msg);
}

// ======================= 17. دوال جلب البيانات الأساسية =======================

async function getData(symbol, interval = '15m', limit = 200) {
  return await MultiExchangeData.getData(symbol, interval, limit);
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

async function fetchAlphaCoins(exchange = 'Binance') {
  try {
    let data;
    
    if (exchange === 'Binance') {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      data = await res.json();
      
      return data.filter(i =>
        i.symbol.endsWith('USDT') &&
        !STABLE_COINS_BLACKLIST.some(stable => i.symbol.startsWith(stable))
      ).map(pair => ({
        symbol: pair.symbol.replace('USDT', ''),
        volumeUSD: parseFloat(pair.quoteVolume),
        change24h: parseFloat(pair.priceChangePercent)
      })).filter(c => c.volumeUSD > CONFIG.INSTITUTIONAL.MIN_VOLUME_ALPHA)
        .sort((a, b) => b.volumeUSD - a.volumeUSD)
        .slice(0, 15)
        .map(c => c.symbol);
        
    } else if (exchange === 'Bybit') {
      const res = await fetch(`${CONFIG.EXCHANGES.BYBIT.baseUrl}/v5/market/tickers?category=spot`);
      const data = await res.json();
      if (data.retCode !== 0 || !data.result?.list) return [];
      
      return data.result.list.filter(i =>
        i.symbol.endsWith('USDT') &&
        !STABLE_COINS_BLACKLIST.some(stable => i.symbol.startsWith(stable))
      ).map(pair => ({
        symbol: pair.symbol.replace('USDT', ''),
        volumeUSD: parseFloat(pair.volume24h) * parseFloat(pair.lastPrice),
        change24h: parseFloat(pair.price24hPcnt) * 100
      })).filter(c => c.volumeUSD > 5000000)
        .sort((a, b) => b.volumeUSD - a.volumeUSD)
        .slice(0, 15)
        .map(c => c.symbol);
    }
    
    return [];
  } catch (e) {
    console.error(`Error fetching alpha coins from ${exchange}:`, e);
    return [];
  }
}

// ======================= 18. الماسح الضوئي المتطور =======================

async function advancedScanner(env) {
  console.log('🔄 Advanced Scanner V11.0 Starting...');
  console.log('📊 Multi-Exchange Mode: Binance + Bybit');
  
  const kv = env?.SIGNALS_KV;
  const learningSystem = new InstitutionalLearningSystem(kv);
  await learningSystem.initialize();
  
  const riskManager = new AdvancedRiskManager(kv);
  await riskManager.initialize();
  
  const canTrade = riskManager.canTrade();
  if (!canTrade.allowed) {
    console.log(`⛔ ${canTrade.reason}`);
    return;
  }
  
  const [btcBullish, btcData, ethData] = await Promise.all([
    isBTCBullish(),
    getData('BTCUSDT', '15m', 100),
    getData('ETHUSDT', '15m', 100)
  ]);
  
  let watchList = [...INSTITUTIONAL_WATCH_LIST];
  
  const [alphaBinance, alphaBybit] = await Promise.all([
    fetchAlphaCoins('Binance'),
    fetchAlphaCoins('Bybit')
  ]);
  
  const alphaCoins = [...new Set([...alphaBinance, ...alphaBybit])];
  if (alphaCoins.length > 0) {
    watchList = [...new Set([...watchList, ...alphaCoins])].slice(0, 50);
    console.log(`📊 تم إضافة ${alphaCoins.length} عملة ألفا`);
  }
  
  let allSignals = [];
  
  for (const direction of ['LONG', 'SHORT']) {
    for (let i = 0; i < watchList.length; i += CONFIG.BATCH_SIZE) {
      const batch = watchList.slice(i, i + CONFIG.BATCH_SIZE);
      
      const results = await Promise.all(batch.map(async coin => {
        let signal = await processCoinEnhanced(
          coin, kv, btcBullish, btcData, ethData,
          direction, learningSystem, riskManager, 'Binance'
        );
        
        if (!signal) {
          signal = await processCoinEnhanced(
            coin, kv, btcBullish, btcData, ethData,
            direction, learningSystem, riskManager, 'Bybit'
          );
        }
        
        return signal;
      }));
      
      allSignals = [...allSignals, ...results.filter(s => s !== null)];
      await delay(CONFIG.DELAY);
    }
  }
  
  const bestSignals = AdvancedRecommendationSystem.filterRecommendations(allSignals);
  
  if (bestSignals.length > 0) {
    for (const signal of bestSignals) {
      await sendEnhancedSignal(signal);
    }
    console.log(`✅ تم إرسال ${bestSignals.length} توصية ممتازة`);
  } else {
    console.log('📭 لا توجد توصيات مؤهلة حالياً');
  }
  
  console.log('✅ Advanced Scanner V11.0 Complete');
}

// ======================= 19. إدارة الإشارات النشطة =======================

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

// ======================= 20. Dashboard =======================

const MENU = {
  inline_keyboard: [
    [{ text: "🚀 أفضل الصاعدين", callback_data: "top" }, { text: "💰 سعر BTC", callback_data: "btc" }],
    [{ text: "🎭 مؤشر الخوف", callback_data: "fear" }, { text: "⚡ إشاراتي", callback_data: "my_signals" }],
    [{ text: "📊 Dashboard", callback_data: "dashboard" }, { text: "🔓 التحقق", callback_data: "check_sub" }],
    [{ text: "🔄 فحص فوري", callback_data: "scan" }]
  ]
};

function getDashboardHTML(activeSignals, history, riskData) {
  const stats = calculateStats(history);
  
  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TRADING AI PRO V11.0 - Dashboard</title>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{font-family:'Segoe UI',sans-serif;background:#0a0a1a;color:#fff;padding:20px}
      .container{max-width:1400px;margin:0 auto}
      .header{text-align:center;padding:30px 0}
      .header h1{font-size:2.5em;background:linear-gradient(135deg,#00d4ff,#7b2ffc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin-bottom:30px}
      .stat-card{background:rgba(255,255,255,0.05);border-radius:15px;padding:20px;text-align:center;border:1px solid rgba(255,255,255,0.05)}
      .stat-card .label{font-size:11px;text-transform:uppercase;color:#888;letter-spacing:1px}
      .stat-card .value{font-size:28px;font-weight:bold;margin-top:8px}
      .stat-card .value.green{color:#00ff88}
      .stat-card .value.red{color:#ff4444}
      .stat-card .value.gold{color:#ffd700}
      .stat-card .value.blue{color:#00b4d8}
      .card{background:rgba(255,255,255,0.05);border-radius:15px;padding:20px;margin-bottom:20px;border:1px solid rgba(255,255,255,0.05)}
      .card h3{color:#00b4d8;margin-bottom:15px;font-size:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{padding:10px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.05)}
      th{color:#00b4d8;font-size:11px;text-transform:uppercase}
      .status-win{color:#00ff88}
      .status-loss{color:#ff4444}
      .badge{padding:2px 12px;border-radius:20px;font-size:11px;font-weight:bold}
      .badge-win{background:rgba(0,255,136,0.2);color:#00ff88}
      .badge-loss{background:rgba(255,68,68,0.2);color:#ff4444}
      .badge-open{background:rgba(255,170,0,0.2);color:#ffaa00}
      .footer{text-align:center;color:#555;font-size:12px;margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.05)}
      @media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🏆 TRADING AI PRO V11.0</h1>
        <div style="color:#666;font-size:14px">Multi-Exchange Ultimate Edition • SMC/ICT</div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card"><div class="label">📊 إجمالي</div><div class="value gold">${history.length + activeSignals.length}</div></div>
        <div class="stat-card"><div class="label">✅ الرابحة</div><div class="value green">${history.filter(s => s.status === 'WIN').length}</div></div>
        <div class="stat-card"><div class="label">❌ الخاسرة</div><div class="value red">${history.filter(s => s.status === 'LOSS').length}</div></div>
        <div class="stat-card"><div class="label">📈 نسبة النجاح</div><div class="value gold">${stats.winRate || 0}%</div></div>
        <div class="stat-card"><div class="label">💰 الأرباح</div><div class="value ${stats.totalProfit >= 0 ? 'green' : 'red'}">${stats.totalProfit >= 0 ? '+' : ''}${(stats.totalProfit || 0).toFixed(2)}%</div></div>
        <div class="stat-card"><div class="label">⚡ نشطة</div><div class="value blue">${activeSignals.length}</div></div>
        <div class="stat-card"><div class="label">🎯 Profit Factor</div><div class="value gold">${stats.profitFactor || 'N/A'}</div></div>
        <div class="stat-card"><div class="label">⭐ التقييم</div><div class="value gold">${stats.grade || 'N/A'}</div></div>
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
            ${activeSignals.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:#666">لا توجد إشارات نشطة</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h3>📜 آخر الصفقات</h3>
        <table>
          <thead><tr><th>العملة</th><th>النوع</th><th>الربح</th><th>النتيجة</th></tr></thead>
          <tbody>
            ${history.slice(0, 10).map(s => `
              <tr>
                <td><strong>${s.coin}</strong></td>
                <td>${s.side}</td>
                <td class="${(s.finalProfit || 0) >= 0 ? 'status-win' : 'status-loss'}">${(s.finalProfit || 0).toFixed(2)}%</td>
                <td><span class="badge ${s.status === 'WIN' ? 'badge-win' : 'badge-loss'}">${s.status === 'WIN' ? '✅ ربح' : '❌ خسارة'}</span></td>
              </tr>
            `).join('')}
            ${history.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#666">لا توجد صفقات سابقة</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      
      <div class="footer">V11.0 Multi-Exchange Ultimate Edition • ${new Date().toLocaleString()}</div>
    </div>
  </body>
  </html>`;
}

function calculateStats(history) {
  if (history.length === 0) return { winRate: 0, totalProfit: 0, profitFactor: 'N/A', grade: 'N/A' };
  
  const wins = history.filter(s => s.status === 'WIN').length;
  const losses = history.filter(s => s.status === 'LOSS').length;
  const totalProfit = history.reduce((sum, s) => sum + (s.finalProfit || 0), 0);
  const winRate = ((wins / history.length) * 100).toFixed(1);
  
  const totalWin = history.filter(s => s.status === 'WIN').reduce((sum, s) => sum + (s.finalProfit || 0), 0);
  const totalLoss = Math.abs(history.filter(s => s.status === 'LOSS').reduce((sum, s) => sum + (s.finalProfit || 0), 0));
  const profitFactor = totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : totalWin > 0 ? '∞' : '0';
  
  let grade = 'N/A';
  if (winRate > 70 && totalProfit > 0) grade = '⭐ ممتاز';
  else if (winRate > 60 && totalProfit > 0) grade = '👍 جيد';
  else if (winRate > 50) grade = '📊 متوسط';
  else grade = '⚠️ يحتاج تطوير';
  
  return { winRate, totalProfit, profitFactor, grade };
}

// ======================= 21. دوال المساعدة للتليجرام =======================

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

// ======================= 22. الـ Handler الرئيسي =======================

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(advancedScanner(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env.SIGNALS_KV;

    if (url.pathname === '/dashboard' || url.pathname === '/') {
      const active = kv ? JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]') : [];
      const history = kv ? JSON.parse(await kv.get('HISTORY_SIGNALS') || '[]') : [];
      const riskData = kv ? JSON.parse(await kv.get('RISK_DATA') || '{}') : {};
      return new Response(getDashboardHTML(active, history, riskData), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

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
        version: 'V11.0 Multi-Exchange Ultimate'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname === '/scan') {
      ctx.waitUntil(advancedScanner(env));
      return new Response('🔍 Advanced Scanner V11.0 Scanning...', { status: 200 });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

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
            ctx.waitUntil(advancedScanner(env));
            await sendTelegram(cb.message.chat.id, '🔍 *جاري الفحص المؤسسي V11.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.');
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
              `📊 *Dashboard V11.0*\nhttps://${url.hostname}/dashboard`
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

        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();
          const userId = update.message.from.id;
          const isSubscribed = await isUserSubscribed(userId);

          if (text === '/start') {
            if (!isSubscribed) {
              const startMsg = `🤖 *TRADING AI PRO V11.0*\n━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ *الاشتراك مطلوب للاستخدام!*\n\nيرجى الاشتراك في قناتنا أولاً:\n👉 ${REQUIRED_CHANNEL}\n\nبعد الاشتراك، ارسل /start مرة أخرى للتحقق.`;
              const subKeyboard = {
                inline_keyboard: [[{ text: "📢 انضم للقناة", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]]
              };
              await sendTelegram(chatId, startMsg, subKeyboard);
            } else {
              await sendTelegram(chatId,
                `🤖 *TRADING AI PRO V11.0* 🔐\n━━━━━━━━━━━━━━━━━━━━━\n✅ *اشتراكك نشط* ✅\n\n🔹 *المميزات:*\n✅ Institutional SMC\n✅ Daily Bias متقدم\n✅ Multi-Exchange (Binance + Bybit)\n✅ Order Block + FVG + Sweep\n✅ SMT Divergence\n✅ VWAP + Volume Profile\n✅ CVD + Footprint\n✅ نظام تعلم ذاتي\n✅ إدارة مخاطر متقدمة\n✅ Dashboard متطور\n\n📊 Dashboard: https://${url.hostname}/dashboard\n\nاختر من القائمة:`, MENU
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
            ctx.waitUntil(advancedScanner(env));
            await sendTelegram(chatId, '🔍 *جاري الفحص المؤسسي V11.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.');
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
