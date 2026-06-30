// ============================================================
// 🏆 TRADING AI PRO V11.0 - OPTIMIZED EDITION
// Smart Money Concept | ICT | Crypto Trading
// ============================================================

// ======================= 1. الإعدادات الأساسية =======================

const BOT_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI';
const REQUIRED_CHANNEL = '@mrcrypto166';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 5,
  MIN_RISK_REWARD: 2.0,
  SCORE_STRONG: 90,
  SCORE_BUY: 75,
  SCORE_WATCH: 60,
  COOLDOWN_HOURS: 3,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 3.5],
  CACHE_TTL_MS: 300000,
  BATCH_SIZE: 2,
  DELAY: 800,
  
  RECOMMENDATIONS: {
    MAX_PER_SCAN: 3,
    MIN_CONFIDENCE: 60,
    MIN_HTF_ALIGNMENT: 0.6,
    MIN_SENTIMENT_SCORE: 50
  },
  
  RISK: {
    MAX_POSITION_SIZE_PERCENT: 20,
    MAX_DAILY_LOSS_PERCENT: 5,
    MAX_CONSECUTIVE_LOSSES: 3,
    MIN_RISK_REWARD: 2.0,
    TRAILING_STOP_ACTIVATION: 1.5,
    TRAILING_STOP_DISTANCE: 0.5
  },
  
  SMC: {
    MIN_OB_STRENGTH: 1.5,
    MIN_FVG_SIZE_PIPS: 2,
    MIN_SWING_STRENGTH: 1.5,
    LIQUIDITY_SWEEP_TOLERANCE: 0.5
  },
  
  RSI: {
    BULLISH_MIN: 40,
    BULLISH_MAX: 60,
    BEARISH_MIN: 40,
    BEARISH_MAX: 60,
    OVERSOLD: 30,
    OVERBOUGHT: 70
  },
  
  KILL_ZONES: {
    LONDON: { start: 7, end: 10 },
    NEW_YORK: { start: 13, end: 16 },
    ASIA: { start: 22, end: 2 }
  }
};

// ======================= 2. القوائم =======================

const INSTITUTIONAL_WATCH_LIST = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 
  'LINK', 'MATIC', 'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR'
];

const STABLE_COINS_BLACKLIST = [
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDD', 'FRAX', 'LUSD', 'GUSD'
];

// ======================= 3. المتغيرات العامة =======================

let dataCache = new Map();
let lastSend = 0;
let messageQueue = [];
let isProcessingQueue = false;

const delay = ms => new Promise(r => setTimeout(r, ms));

// ======================= 4. دوال الإرسال =======================

async function sendTelegram(chatId, text, keyboard = null) {
  if (!BOT_TOKEN) return;
  messageQueue.push({ chatId, text, keyboard });
  processQueue();
}

async function sendTelegramImmediate(chatId, text, keyboard = null) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
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
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}

async function processQueue() {
  if (!BOT_TOKEN) return;
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

// ======================= 5. جلب البيانات =======================

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

// ======================= 6. المؤشرات الأساسية =======================

class Indicators {
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
}

// ======================= 7. SMC المبسط =======================

class SMC {
  static detectLiquidity(data) {
    if (data.length < 30) return { sweeps: [], hasSweep: false };
    
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);
    const closes = data.map(d => d.close);
    
    const swingHighs = [];
    const swingLows = [];
    
    for (let i = 3; i < data.length - 3; i++) {
      let isHigh = true;
      let isLow = true;
      
      for (let j = i - 3; j <= i + 3; j++) {
        if (j === i) continue;
        if (highs[j] >= highs[i]) isHigh = false;
        if (lows[j] <= lows[i]) isLow = false;
      }
      
      if (isHigh) swingHighs.push({ price: highs[i], index: i });
      if (isLow) swingLows.push({ price: lows[i], index: i });
    }
    
    const equalHighs = [];
    const equalLows = [];
    const tolerance = 0.005;
    
    for (let i = 0; i < swingHighs.length; i++) {
      for (let j = i + 1; j < swingHighs.length; j++) {
        const diff = Math.abs(swingHighs[i].price - swingHighs[j].price) / swingHighs[i].price;
        if (diff < tolerance) {
          equalHighs.push({ price: swingHighs[i].price });
        }
      }
    }
    
    for (let i = 0; i < swingLows.length; i++) {
      for (let j = i + 1; j < swingLows.length; j++) {
        const diff = Math.abs(swingLows[i].price - swingLows[j].price) / swingLows[i].price;
        if (diff < tolerance) {
          equalLows.push({ price: swingLows[i].price });
        }
      }
    }
    
    const sweeps = [];
    const currentPrice = closes[closes.length - 1];
    const lastCandle = data[data.length - 1];
    
    for (const level of equalHighs) {
      if (currentPrice > level.price && lastCandle.close < level.price) {
        sweeps.push({ type: 'SELL', level: level.price });
      }
    }
    
    for (const level of equalLows) {
      if (currentPrice < level.price && lastCandle.close > level.price) {
        sweeps.push({ type: 'BUY', level: level.price });
      }
    }
    
    return {
      sweeps,
      hasSweep: sweeps.length > 0,
      strongestSweep: sweeps.length > 0 ? sweeps[0] : null
    };
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
          fvgs.push({
            type: 'BULLISH',
            high: c3.low,
            low: c1.high,
            size: sizePips,
            isMitigated: isMitigated
          });
        }
      }
      
      if (c1.low > c3.high) {
        const size = c1.low - c3.high;
        const sizePips = size / pipValue;
        if (sizePips >= CONFIG.SMC.MIN_FVG_SIZE_PIPS) {
          const isMitigated = data.slice(i + 3).some(c => c.close <= c1.low && c >= c3.high);
          fvgs.push({
            type: 'BEARISH',
            high: c1.low,
            low: c3.high,
            size: sizePips,
            isMitigated: isMitigated
          });
        }
      }
    }
    
    return fvgs.length > 0 ? fvgs.sort((a, b) => b.size - a.size)[0] : null;
  }

  static detectOrderBlock(data) {
    if (data.length < 20) return null;
    
    const orders = [];
    const avgVolume = data.slice(-15).reduce((a, b) => a + b.vol, 0) / 15;
    
    for (let i = data.length - 10; i < data.length - 2; i++) {
      const candle = data[i];
      const nextCandle = data[i + 1];
      
      if (!candle || !nextCandle) continue;
      
      const bodySize = Math.abs(candle.close - candle.open);
      const avgBody = data.slice(i - 5, i).reduce((a, b) => a + Math.abs(b.close - b.open), 0) / 5;
      const bodyRatio = bodySize / (candle.high - candle.low);
      
      if (bodyRatio < 0.3) continue;
      if (candle.vol < avgVolume * 1.5) continue;
      if (bodySize < avgBody * 1.2) continue;
      
      if (candle.close < candle.open && nextCandle.close > nextCandle.open) {
        const strength = (nextCandle.close - nextCandle.open) / (candle.high - candle.low);
        if (strength > CONFIG.SMC.MIN_OB_STRENGTH) {
          orders.push({
            type: 'BULLISH',
            price: candle.high,
            strength: Math.min(strength, 5),
            isMitigated: data.slice(i + 2).some(c => c.close <= candle.high && c.close >= candle.low)
          });
        }
      }
      
      if (candle.close > candle.open && nextCandle.close < nextCandle.open) {
        const strength = (candle.open - candle.close) / (candle.high - candle.low);
        if (strength > CONFIG.SMC.MIN_OB_STRENGTH) {
          orders.push({
            type: 'BEARISH',
            price: candle.low,
            strength: Math.min(strength, 5),
            isMitigated: data.slice(i + 2).some(c => c.close <= candle.high && c.close >= candle.low)
          });
        }
      }
    }
    
    return orders.length > 0 ? orders.sort((a, b) => b.strength - a.strength)[0] : null;
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

// ======================= 8. Daily Bias المبسط =======================

class DailyBias {
  static async analyze(symbol, dataDaily, data4h, data1h) {
    let score = 0;
    
    if (dataDaily) {
      const closes = dataDaily.map(d => d.close);
      const ema20 = Indicators.ema(closes, 20);
      const ema50 = Indicators.ema(closes, 50);
      const currentPrice = closes[closes.length - 1];
      
      if (currentPrice > ema20 && ema20 > ema50) score += 0.3;
      else if (currentPrice < ema20 && ema20 < ema50) score -= 0.3;
    }
    
    if (data4h) {
      const highs = data4h.map(d => d.high);
      const lows = data4h.map(d => d.low);
      const currentPrice = data4h[data4h.length - 1].close;
      const mid = (Math.max(...highs) + Math.min(...lows)) / 2;
      
      if (currentPrice < mid) score += 0.2;
      else if (currentPrice > mid) score -= 0.2;
    }
    
    if (data1h) {
      const closes = data1h.map(d => d.close);
      const open = data1h[0].open;
      const close = closes[closes.length - 1];
      
      if (close > open) score += 0.3;
      else if (close < open) score -= 0.3;
    }
    
    let bias = 'NEUTRAL';
    let confidence = 0;
    
    if (score > 0.2) {
      bias = 'BULLISH';
      confidence = Math.min(score, 1);
    } else if (score < -0.2) {
      bias = 'BEARISH';
      confidence = Math.min(Math.abs(score), 1);
    }
    
    return { bias, confidence, score };
  }
}

// ======================= 9. نظام إدارة المخاطر =======================

class RiskManager {
  constructor(kv) {
    this.kv = kv;
    this.accountBalance = 10000;
    this.dailyLoss = 0;
    this.consecutiveLosses = 0;
  }

  async initialize() {
    try {
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
    } catch (e) {
      console.error('Risk init error:', e);
    }
  }

  async save() {
    try {
      await this.kv?.put('RISK_DATA', JSON.stringify({
        balance: this.accountBalance,
        dailyLoss: this.dailyLoss,
        consecutiveLosses: this.consecutiveLosses,
        lastReset: Date.now()
      }));
    } catch (e) {
      console.error('Risk save error:', e);
    }
  }

  calculatePositionSize(entryPrice, stopLoss, riskPercent = 2) {
    const riskAmount = this.accountBalance * (riskPercent / 100);
    const slDistance = Math.abs(entryPrice - stopLoss) / entryPrice;
    
    if (slDistance === 0) return 0;
    
    const positionSize = riskAmount / slDistance / entryPrice;
    const maxPosition = this.accountBalance * (CONFIG.RISK.MAX_POSITION_SIZE_PERCENT / 100) / entryPrice;
    
    return Math.min(positionSize, maxPosition);
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
}

// ======================= 10. نظام التوصيات =======================

class RecommendationSystem {
  static filterRecommendations(signals) {
    let filtered = signals.filter(s => s.score >= CONFIG.RECOMMENDATIONS.MIN_CONFIDENCE);
    filtered.sort((a, b) => b.score - a.score);
    return filtered.slice(0, CONFIG.RECOMMENDATIONS.MAX_PER_SCAN);
  }
}

// ======================= 11. الماسح الضوئي المحسن =======================

async function advancedScanner(env) {
  console.log('🔄 Advanced Scanner V11.0 Starting...');
  
  const kv = env?.KV_BINDING;
  const riskManager = new RiskManager(kv);
  await riskManager.initialize();
  
  const canTrade = riskManager.canTrade();
  if (!canTrade.allowed) {
    console.log(`⛔ ${canTrade.reason}`);
    return;
  }
  
  // جلب بيانات BTC
  console.log('📊 جلب بيانات BTC...');
  const [btcData, ethData] = await Promise.all([
    getData('BTCUSDT', '15m', 50),
    getData('ETHUSDT', '15m', 50)
  ]);
  
  let allSignals = [];
  let processedCoins = 0;
  
  // فحص كل العملات
  for (const coin of INSTITUTIONAL_WATCH_LIST) {
    try {
      processedCoins++;
      console.log(`🔍 فحص ${coin} (${processedCoins}/${INSTITUTIONAL_WATCH_LIST.length})...`);
      
      const symbol = coin + 'USDT';
      
      // جلب البيانات من 3 أطر زمنية
      const [data15m, data1h, data4h, dataDaily] = await Promise.all([
        getData(symbol, '15m', 50),
        getData(symbol, '1h', 30),
        getData(symbol, '4h', 20),
        getData(symbol, '1d', 10)
      ]);
      
      if (!data15m) {
        console.log(`⚠️ ${coin}: لا توجد بيانات`);
        continue;
      }
      
      const currentPrice = data15m[data15m.length - 1].close;
      
      // تحليل LONG
      const longSignal = await analyzeCoin(coin, data15m, data1h, data4h, dataDaily, currentPrice, btcData, ethData, 'LONG');
      if (longSignal) allSignals.push(longSignal);
      
      // تحليل SHORT
      const shortSignal = await analyzeCoin(coin, data15m, data1h, data4h, dataDaily, currentPrice, btcData, ethData, 'SHORT');
      if (shortSignal) allSignals.push(shortSignal);
      
      await delay(CONFIG.DELAY);
      
    } catch (e) {
      console.error(`❌ Error ${coin}:`, e.message);
    }
  }
  
  // ترشيح التوصيات
  const bestSignals = RecommendationSystem.filterRecommendations(allSignals);
  
  if (bestSignals.length > 0) {
    console.log(`✅ تم العثور على ${bestSignals.length} توصية`);
    for (const signal of bestSignals) {
      await sendEnhancedSignal(signal);
    }
  } else {
    console.log('📭 لا توجد توصيات مؤهلة');
  }
  
  console.log('✅ Advanced Scanner Complete');
}

async function analyzeCoin(coin, data15m, data1h, data4h, dataDaily, currentPrice, btcData, ethData, direction) {
  try {
    let score = 0;
    const reasons = [];
    
    // 1. Daily Bias
    const dailyBias = await DailyBias.analyze(coin + 'USDT', dataDaily, data4h, data1h);
    if (dailyBias.bias === direction) {
      score += 20 * dailyBias.confidence;
      reasons.push(`📅 Daily Bias ${direction} (${(dailyBias.confidence * 100).toFixed(0)}%)`);
    } else if (dailyBias.bias === 'NEUTRAL') {
      score += 10;
      reasons.push(`📅 Daily Bias محايد`);
    } else {
      score -= 10;
      reasons.push(`⚠️ Daily Bias معاكس`);
    }
    
    // 2. RSI
    const closes = data15m.map(d => d.close);
    const rsi = Indicators.wilderRSI(closes);
    if (direction === 'LONG' && rsi <= CONFIG.RSI.OVERSOLD) {
      score += 15;
      reasons.push(`📊 RSI ذروة بيع (${rsi})`);
    } else if (direction === 'SHORT' && rsi >= CONFIG.RSI.OVERBOUGHT) {
      score += 15;
      reasons.push(`📊 RSI ذروة شراء (${rsi})`);
    } else if (direction === 'LONG' && rsi >= CONFIG.RSI.BULLISH_MIN && rsi <= CONFIG.RSI.BULLISH_MAX) {
      score += 10;
      reasons.push(`📊 RSI صاعد (${rsi})`);
    } else if (direction === 'SHORT' && rsi >= CONFIG.RSI.BEARISH_MIN && rsi <= CONFIG.RSI.BEARISH_MAX) {
      score += 10;
      reasons.push(`📊 RSI هابط (${rsi})`);
    }
    
    // 3. Liquidity Sweep
    const liquidity = SMC.detectLiquidity(data15m);
    if (liquidity.hasSweep && liquidity.strongestSweep) {
      const sweep = liquidity.strongestSweep;
      if ((sweep.type === 'BUY' && direction === 'LONG') || 
          (sweep.type === 'SELL' && direction === 'SHORT')) {
        score += 20;
        reasons.push(`🦅 Liquidity Sweep (${sweep.type})`);
      }
    }
    
    // 4. FVG
    const fvg = SMC.detectFVG(data15m);
    if (fvg && !fvg.isMitigated) {
      if ((fvg.type === 'BULLISH' && direction === 'LONG') || 
          (fvg.type === 'BEARISH' && direction === 'SHORT')) {
        score += 15;
        reasons.push(`📊 FVG ${fvg.type} (${fvg.size.toFixed(1)} pips)`);
      }
    }
    
    // 5. Order Block
    const ob = SMC.detectOrderBlock(data15m);
    if (ob && !ob.isMitigated) {
      if ((ob.type === 'BULLISH' && direction === 'LONG') || 
          (ob.type === 'BEARISH' && direction === 'SHORT')) {
        score += 15;
        reasons.push(`🏛️ Order Block ${ob.type}`);
      }
    }
    
    // 6. Kill Zone
    const killZone = SMC.getCurrentKillZone();
    if (killZone && (killZone.name === 'LONDON' || killZone.name === 'NEW_YORK')) {
      score += 10;
      reasons.push(`⏰ ${killZone.name} نشطة`);
    }
    
    // 7. VWAP
    const vwap = Indicators.calculateVWAP(data15m);
    if (vwap) {
      if (direction === 'LONG' && currentPrice < vwap * 0.995) {
        score += 10;
        reasons.push(`📊 تحت VWAP`);
      } else if (direction === 'SHORT' && currentPrice > vwap * 1.005) {
        score += 10;
        reasons.push(`📊 فوق VWAP`);
      }
    }
    
    // 8. ATR and Targets
    const atr = Indicators.calculateATR(data15m);
    let tp1, tp2, tp3, sl, rr = 0;
    
    if (atr && atr > 0) {
      if (direction === 'LONG') {
        tp1 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[0]);
        tp2 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[1]);
        tp3 = currentPrice + (atr * CONFIG.TP_ATR_MULTIPLIER[2]);
        sl = currentPrice - (atr * 1);
        rr = (tp3 - currentPrice) / (currentPrice - sl);
      } else {
        tp1 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[0]);
        tp2 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[1]);
        tp3 = currentPrice - (atr * CONFIG.TP_ATR_MULTIPLIER[2]);
        sl = currentPrice + (atr * 1);
        rr = (currentPrice - tp3) / (sl - currentPrice);
      }
    } else {
      if (direction === 'LONG') {
        tp1 = currentPrice * 1.02;
        tp2 = currentPrice * 1.04;
        tp3 = currentPrice * 1.06;
        sl = currentPrice * 0.98;
        rr = (tp3 - currentPrice) / (currentPrice - sl);
      } else {
        tp1 = currentPrice * 0.98;
        tp2 = currentPrice * 0.96;
        tp3 = currentPrice * 0.94;
        sl = currentPrice * 1.02;
        rr = (currentPrice - tp3) / (sl - currentPrice);
      }
    }
    
    if (rr < CONFIG.MIN_RISK_REWARD) {
      score -= 10;
      reasons.push(`⚠️ R/R منخفض (${rr.toFixed(2)})`);
    }
    
    // شرط الإشارة
    if (score >= CONFIG.SCORE_BUY && rr >= CONFIG.MIN_RISK_REWARD) {
      return {
        coin,
        direction,
        entry: currentPrice,
        tp1, tp2, tp3, sl,
        score,
        rr,
        reasons,
        rsi,
        dailyBias: dailyBias.bias,
        killZone: killZone?.name || 'None',
        timestamp: Date.now()
      };
    }
    
    return null;
    
  } catch (e) {
    console.error(`❌ ${coin} analyze error:`, e.message);
    return null;
  }
}

// ======================= 12. إرسال التوصيات =======================

async function sendEnhancedSignal(signal) {
  const emoji = signal.score >= CONFIG.SCORE_STRONG ? '🟢' : '🟡';
  const type = signal.score >= CONFIG.SCORE_STRONG ? 'STRONG BUY' : 'BUY';
  
  let msg = `${emoji} *${type} - ${signal.score}%* ${emoji}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🪙 *${signal.coin}/USDT*\n`;
  msg += `🎯 *${signal.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
  msg += `💰 *$${signal.entry.toFixed(6)}*\n\n`;
  msg += `📊 *R/R: 1:${signal.rr.toFixed(2)}*\n`;
  msg += `🎯 TP1: *$${signal.tp1.toFixed(6)}*\n`;
  msg += `🎯 TP2: *$${signal.tp2.toFixed(6)}*\n`;
  msg += `🎯 TP3: *$${signal.tp3.toFixed(6)}*\n`;
  msg += `🛑 SL: *$${signal.sl.toFixed(6)}*\n\n`;
  msg += `📌 *الأسباب:*\n`;
  msg += `${signal.reasons.slice(0, 6).join("\n")}\n\n`;
  msg += `📊 RSI: ${signal.rsi}\n`;
  msg += `📈 Daily Bias: ${signal.dailyBias}\n`;
  msg += `⏰ ${signal.killZone !== 'None' ? `Kill Zone: ${signal.killZone}` : 'خارج الجلسة'}\n`;
  msg += `⚡ *V11.0 Optimized Edition*`;
  
  await sendTelegram(REQUIRED_CHANNEL, msg);
}

// ======================= 13. Dashboard =======================

function getDashboardHTML(activeSignals, history) {
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
      .badge-long{background:rgba(0,255,136,0.2);color:#00ff88}
      .badge-short{background:rgba(255,68,68,0.2);color:#ff4444}
      .footer{text-align:center;color:#555;font-size:12px;margin-top:30px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.05)}
      @media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>🏆 TRADING AI PRO V11.0</h1>
        <div style="color:#666;font-size:14px">Optimized Edition • SMC/ICT</div>
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
                <td><span class="badge ${s.side === 'LONG 📈' ? 'badge-long' : 'badge-short'}">${s.side}</span></td>
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
      
      <div class="footer">V11.0 Optimized Edition • ${new Date().toLocaleString()}</div>
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

// ======================= 14. دوال المساعدة للتليجرام =======================

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

const MENU = {
  inline_keyboard: [
    [{ text: "🚀 أفضل الصاعدين", callback_data: "top" }, { text: "💰 سعر BTC", callback_data: "btc" }],
    [{ text: "🎭 مؤشر الخوف", callback_data: "fear" }, { text: "⚡ إشاراتي", callback_data: "my_signals" }],
    [{ text: "📊 Dashboard", callback_data: "dashboard" }, { text: "🔄 فحص فوري", callback_data: "scan" }]
  ]
};

// ======================= 15. الـ Handler الرئيسي =======================

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(advancedScanner(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env?.KV_BINDING;

    // ====== TEST ======
    if (url.pathname === '/test') {
      return new Response(JSON.stringify({
        status: '✅ Worker شغال!',
        token: BOT_TOKEN ? '✅ موجود' : '❌ غير موجود',
        kv: kv ? '✅ مربوط' : '❌ غير مربوط',
        watchList: INSTITUTIONAL_WATCH_LIST.length,
        time: new Date().toISOString()
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ====== Dashboard ======
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      const active = kv ? JSON.parse(await kv.get('ACTIVE_SIGNALS') || '[]') : [];
      const history = kv ? JSON.parse(await kv.get('HISTORY_SIGNALS') || '[]') : [];
      return new Response(getDashboardHTML(active, history), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ====== API Stats ======
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
        version: 'V11.0 Optimized Edition',
        status: '🟢 Online'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ====== Scan ======
    if (url.pathname === '/scan') {
      ctx.waitUntil(advancedScanner(env));
      return new Response('🔍 Advanced Scanner V11.0 Scanning...', { 
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    // ====== Webhook ======
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data;

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
                msg += `\n🪙 *${s.coin}* | ${s.side}\n💰 $${s.entry?.toFixed(6)}\n🎯 TP1: $${s.tp1?.toFixed(6)}\n🎯 TP2: $${s.tp2?.toFixed(6)}\n🎯 TP3: $${s.tp3?.toFixed(6)}\n🛑 SL: $${s.sl?.toFixed(6)}\n`;
              });
              await sendTelegram(cb.message.chat.id, msg);
            }
          }

          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            body: JSON.stringify({ callback_query_id: cb.id })
          });
          return new Response('OK');
        }

        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();

          if (text === '/start') {
            await sendTelegram(chatId,
              `🤖 *TRADING AI PRO V11.0* 🔐\n━━━━━━━━━━━━━━━━━━━━━\n✅ *البوت شغال!*\n\n🔹 *المميزات:*\n✅ SMC متقدم\n✅ Daily Bias\n✅ Multi-Exchange\n✅ إدارة مخاطر\n✅ Dashboard متطور\n\n📊 Dashboard: https://${url.hostname}/dashboard\n\nاختر من القائمة:`, MENU
            );
          } else if (text === '/menu') {
            await sendTelegram(chatId, '📋 *القائمة الرئيسية*\nاختر أحد الخيارات:', MENU);
          } else if (text === '/scan') {
            ctx.waitUntil(advancedScanner(env));
            await sendTelegram(chatId, '🔍 *جاري الفحص المؤسسي V11.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.');
          } else if (text === '/dashboard') {
            await sendTelegram(chatId,
              `📊 *Dashboard V11.0*\nhttps://${url.hostname}/dashboard`
            );
          } else {
            await sendTelegram(chatId, `📋 استخدم /start للقائمة الرئيسية\n📊 Dashboard: https://${url.hostname}/dashboard`);
          }
        }

      } catch (e) {
        console.error('Webhook error:', e);
        return new Response('Error: ' + e.message, { status: 500 });
      }
      return new Response('OK');
    }

    return new Response('404 Not Found', { 
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};
