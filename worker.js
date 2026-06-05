// ============================================================
// TRADING AI PRO V15.1 - MULTI-CATEGORY SCANNER
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 15,
  MIN_VOLUME_USD: 1000000,
  COOLDOWN_HOURS: 2,
  BATCH_SIZE: 4,
  DELAY: 1000,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 4.0],
  ACCOUNT_RISK_PERCENT: 1.0,
  CACHE_TTL_MS: 30000,
  AI_SCORE_THRESHOLD: 75,
  VOLUME_RATIO_THRESHOLD: 1.3,
  TIMEFRAMES: {
    MASTER: '4h',
    CONFIRM: '1h',
    ENTRY: '15m'
  }
};

// ========== أقسام العملات ==========
const CATEGORIES = {
  // 💰 العملات الكبرى (Blue Chips)
  MAJOR: [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON',
    'MATIC', 'ATOM', 'UNI', 'AAVE', 'MKR', 'CRV', 'LTC', 'BCH', 'ETC'
  ],
  
  // 🚀 عملات الألفا (Mid Cap)
  ALPHA: [
    'SUI', 'NEAR', 'APT', 'FET', 'RNDR', 'OP', 'ARB', 'IMX', 'STX', 'SEI',
    'TIA', 'INJ', 'JUP', 'PYTH', 'STRK', 'TAO', 'WLD', 'AGIX', 'OCEAN'
  ],
  
  // 🐶 عملات الميم (Memes)
  MEME: [
    'DOGE', 'PEPE', 'WIF', 'FLOKI', 'BONK', 'SHIB', 'BRETT', 'BOME', 'MEW',
    'POPCAT', 'MOODENG', 'NEIRO', 'TURBO', 'MYRO', 'SAMO'
  ],
  
  // 🔥 عملات الإنفجار (High Volatility)
  HIGH_VOL: [
    'PEPE', 'WIF', 'BONK', 'POPCAT', 'NEIRO', 'TURBO', 'MYRO', 'BRETT'
  ],
  
  // 🎯 جميع العملات (All in One)
  ALL: []
};

// تجميع القائمة الكاملة
CATEGORIES.ALL = [...CATEGORIES.MAJOR, ...CATEGORIES.ALPHA, ...CATEGORIES.MEME];

// القسم الافتراضي
let CURRENT_CATEGORY = 'MAJOR';

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();

// ========== المؤشرات الفنية (نفسها كما هي) ==========
function ema(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let e = data[0];
  for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
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

function calculatePremiumScore({ structure, sweep, fvg, volumeRatio, pdZone, entrySide, ob }) {
  let score = 20;
  if (structure === (entrySide === 'LONG' ? "BULLISH" : "BEARISH")) score += 30;
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 20;
  if (volumeRatio >= 1.3) score += 15;
  if (fvg) score += 10;
  if ((entrySide === 'LONG' && ob.bullish) || (entrySide === 'SHORT' && ob.bearish)) score += 5;
  return Math.min(score, 100);
}

function calculatePositionSize(accountBalance, entryPrice, stopLoss) {
  const riskAmount = accountBalance * (CONFIG.ACCOUNT_RISK_PERCENT / 100);
  const priceDifference = Math.abs(entryPrice - stopLoss);
  const positionSize = riskAmount / priceDifference;
  const recommendedLeverage = Math.min(10, Math.floor((positionSize * entryPrice) / accountBalance) + 1);
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

async function sendTelegram(token, chatId, text, keyboard = null) {
  if (Date.now() - lastSend < 1000) return;
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch(e) {}
}

// ========== معالجة العملات مع القسم المختار ==========
async function processCoin(coin, token, kv) {
  try {
    const symbol = coin + 'USDT';
    let cooldown = kv ? JSON.parse(await kv.get('COOLDOWN') || '{}') : {};
    if (cooldown[symbol] && Date.now() - cooldown[symbol] < CONFIG.COOLDOWN_HOURS * 60 * 60 * 1000) return null;
    
    let signalsToday = kv ? parseInt(await kv.get('SIGNALS_TODAY') || '0') : 0;
    if (signalsToday >= CONFIG.MAX_SIGNALS_PER_DAY) return null;

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

    const score = calculatePremiumScore({ structure: mtf.trend, sweep, fvg, volumeRatio: volume.ratio, pdZone, entrySide, ob });
    if (score < CONFIG.AI_SCORE_THRESHOLD) return null;

    const last = dataEntry[dataEntry.length - 1];
    const atr = calculateATR(dataEntry);
    if (!atr) return null;

    const isLong = mtf.trend === "BULLISH";
    const entryPrice = last.close;
    const sl = isLong ? entryPrice - atr : entryPrice + atr;
    const tp1 = isLong ? entryPrice + atr * 1.5 : entryPrice - atr * 1.5;
    const tp2 = isLong ? entryPrice + atr * 2.5 : entryPrice - atr * 2.5;
    const tp3 = isLong ? entryPrice + atr * 4.0 : entryPrice - atr * 4.0;

    const position = calculatePositionSize(10000, entryPrice, sl);

    // تحديد تصنيف العملة في أي قسم
    let category = 'MAJOR';
    if (CATEGORIES.ALPHA.includes(coin)) category = 'ALPHA 🚀';
    if (CATEGORIES.MEME.includes(coin)) category = 'MEME 🐶';
    if (CATEGORIES.HIGH_VOL.includes(coin)) category = 'HIGH VOL 🔥';

    const msg = `🏦 *V15 PREMIUM SIGNAL* 🏦
━━━━━━━━━━━━━━━━━━━━
📊 *القسم:* ${category}
🪙 *العملة:* ${coin}/USDT
🎯 *التوجيه:* ${isLong ? 'LONG 📈' : 'SHORT 📉'}
💰 *سعر الدخول:* \`$${entryPrice.toFixed(4)}\`
📊 *قوة الصفقة:* \`${score}/100\`

🎯 *TP1:* \`$${tp1.toFixed(4)}\`
🎯 *TP2:* \`$${tp2.toFixed(4)}\`
🎯 *TP3:* \`$${tp3.toFixed(4)}\`
🛑 *SL:* \`$${sl.toFixed(4)}\`

📊 *إدارة المخاطر:* ${CONFIG.ACCOUNT_RISK_PERCENT}% | حجم: ${position.positionSize} ${coin}

🏆 *AI Trading Engine V15.1 PRO*`;

    await sendTelegram(token, TELEGRAM_CHAT_ID, msg);

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

// ========== الماسح الضوئي حسب القسم ==========
async function marketScanner(token, kv, category = null) {
  const watchList = category ? CATEGORIES[category] : CATEGORIES[CURRENT_CATEGORY];
  if (!watchList || watchList.length === 0) {
    console.log(`❌ القسم ${category || CURRENT_CATEGORY} لا يحتوي على عملات`);
    return;
  }
  
  console.log(`🔍 فحص القسم: ${category || CURRENT_CATEGORY} (${watchList.length} عملة)`);
  
  for (let i = 0; i < watchList.length; i += CONFIG.BATCH_SIZE) {
    const batch = watchList.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(coin => processCoin(coin, token, kv)));
    await delay(CONFIG.DELAY);
  }
}

// ========== جلب الأسعار ==========
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

// ========== القوائم التفاعلية ==========
const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: "💰 سعر BTC", callback_data: "cmd_btc" }, { text: "💎 سعر ETH", callback_data: "cmd_eth" }],
    [{ text: "🔥 أفضل 5 صعوداً", callback_data: "cmd_top" }, { text: "📊 مؤشر الخوف", callback_data: "cmd_fear" }],
    [{ text: "🏦 العملات الكبرى", callback_data: "scan_major" }, { text: "🚀 عملات الألفا", callback_data: "scan_alpha" }],
    [{ text: "🐶 عملات الميم", callback_data: "scan_meme" }, { text: "🔥 فحص الكل", callback_data: "scan_all" }],
    [{ text: "📈 إحصائيات", callback_data: "cmd_stats" }, { text: "👑 ميزات V15", callback_data: "cmd_about" }]
  ]
};

function getSubscribeKeyboard(inviteLink) {
  return {
    inline_keyboard: [
      [{ text: "📢 انضم للقناة", url: inviteLink || `https://t.me/c/${TELEGRAM_CHAT_ID.replace('-100', '')}` }],
      [{ text: "✅ تم الانضمام (تفعيل)", callback_data: "check_sub" }]
    ]
  };
}

// ========== تشغيل الـ Worker ==========
export default {
  async scheduled(event, env, ctx) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (token) ctx.waitUntil(marketScanner(token, env.SIGNALS_KV, 'MAJOR'));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;
    const kv = env.SIGNALS_KV;

    if (!token) return new Response('❌ Bot token not configured', { status: 500 });

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
      return new Response(`<h1>🏦 V15.1 ENGINE ACTIVE</h1>
<p>Total Signals: ${stats.total}</p>
<p>Categories: MAJOR(${CATEGORIES.MAJOR.length}) | ALPHA(${CATEGORIES.ALPHA.length}) | MEME(${CATEGORIES.MEME.length})</p>`, 
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
              await sendTelegram(token, chatId, `🎉 *تم التفعيل!*\nاختر القسم لبدء الفحص:`, MENU_KEYBOARD);
            } else {
              await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                body: JSON.stringify({ callback_query_id: cb.id, text: "❌ غير مشترك!", show_alert: true })
              });
            }
            return new Response('OK');
          }

          const isSubbed = await checkChannelSubscription(token, userId);
          if (!isSubbed) {
            await sendTelegram(token, chatId, `⚠️ اشترك أولاً!`, getSubscribeKeyboard(env.CHANNEL_INVITE_LINK));
            return new Response('OK');
          }

          // أوامر المسح حسب القسم
          if (data === 'scan_major') {
            await sendTelegram(token, chatId, `🔍 جاري فحص العملات الكبرى (${CATEGORIES.MAJOR.length} عملة)...`);
            ctx.waitUntil(marketScanner(token, kv, 'MAJOR'));
          } else if (data === 'scan_alpha') {
            await sendTelegram(token, chatId, `🚀 جاري فحص عملات الألفا (${CATEGORIES.ALPHA.length} عملة)...`);
            ctx.waitUntil(marketScanner(token, kv, 'ALPHA'));
          } else if (data === 'scan_meme') {
            await sendTelegram(token, chatId, `🐶 جاري فحص عملات الميم (${CATEGORIES.MEME.length} عملة)...`);
            ctx.waitUntil(marketScanner(token, kv, 'MEME'));
          } else if (data === 'scan_all') {
            await sendTelegram(token, chatId, `🎯 جاري الفحص الشامل (${CATEGORIES.ALL.length} عملة)...`);
            ctx.waitUntil(marketScanner(token, kv, 'ALL'));
          } else if (data === 'cmd_btc') {
            const p = await getLivePrice('BTC');
            await sendTelegram(token, chatId, `💰 *BTC:* \`$${p?.toLocaleString()}\``);
          } else if (data === 'cmd_eth') {
            const p = await getLivePrice('ETH');
            await sendTelegram(token, chatId, `💎 *ETH:* \`$${p?.toLocaleString()}\``);
          } else if (data === 'cmd_top') {
            const movers = await getTopMovers();
            await sendTelegram(token, chatId, `🔥 *أفضل الصاعدين*\n${movers.map(m => `🟢 *${m.s}*: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (data === 'cmd_fear') {
            const fng = await getCryptoFearAndGreed();
            await sendTelegram(token, chatId, `📊 *الخوف والطمع:* \`${fng}\``);
          } else if (data === 'cmd_stats') {
            let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
            await sendTelegram(token, chatId, `📊 *الإحصائيات*\nإجمالي الإشارات: ${stats.total}`);
          } else if (data === 'cmd_about') {
            await sendTelegram(token, chatId, `👑 *V15.1 PRO*\n• 4 أقسام: كبرى/ألفا/ميم/الكل\n• ${CATEGORIES.ALL.length} عملة\n• Threshold 75 | Base 20`);
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
              await sendTelegram(token, chatId, `⚠️ اشترك أولاً!`, getSubscribeKeyboard(env.CHANNEL_INVITE_LINK));
              return new Response('OK');
            }
            await sendTelegram(token, chatId, `🏦 *V15.1 PRO* 🏦\n━━━━━━━━━━━━━━━━━━━━━\n📊 *الأقسام المتاحة:*\n• 🏦 كبرى (${CATEGORIES.MAJOR.length})\n• 🚀 ألفا (${CATEGORIES.ALPHA.length})\n• 🐶 ميم (${CATEGORIES.MEME.length})\n\nاختر من الأزرار`, MENU_KEYBOARD);
            return new Response('OK');
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
