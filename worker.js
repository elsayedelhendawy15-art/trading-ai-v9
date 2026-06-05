// ============================================================
// TRADING AI PRO V15.5 - THE MASTER-CLASS QUANT SNIPER
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059';

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 25,       // فريم 5 د يتيح صفقات أكثر دقة واقتناصاً
  MIN_VOLUME_USD: 1000000,
  COOLDOWN_HOURS: 1,             
  BATCH_SIZE: 4,
  DELAY: 800,                    // تسريع الفحص اللحظي
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  ACCOUNT_RISK_PERCENT: 1.0,     // مخاطرة 1% من المحفظة
  CACHE_TTL_MS: 15000,           // كاش سريع جداً لملائمة فريم 5 د
  AI_SCORE_THRESHOLD: 80,        // سكور صارم لضمان الجودة
  VOLUME_RATIO_THRESHOLD: 1.3,
  TIMEFRAMES: {
    MASTER: '1h',                // الاتجاه العام
    CONFIRM: '15m',              // التأكيد المتوسط
    ENTRY: '5m'                  // نقطة القنص اللحظية
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

function formatPrice(price, coin) {
  if (!price) return "0.00";
  if (price < 0.001) return price.toFixed(7);
  if (price < 1.0) return price.toFixed(5);
  return price.toFixed(2);
}

function ema(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let e = data[0];
  for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}

// دالة الـ ATR المطورة والمقلمة لتعطي ستوب لوز دقيق بالسنتيمتر
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

function calculatePremiumScore({ structure, sweep, fvg, volumeRatio, pdZone, entrySide, ob }) {
  let score = 20;
  if (structure === (entrySide === 'LONG' ? "BULLISH" : "BEARISH")) score += 30;
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 20;
  if (volumeRatio >= 1.3) score += 15;
  if (fvg) score += 10;
  if ((entrySide === 'LONG' && ob.bullish) || (entrySide === 'SHORT' && ob.bearish)) score += 5;
  return Math.min(score, 100);
}

// دالة حساب حجم الصفقة والرافعة الموصى بها الذكية لفريم 5 دقائق
function calculatePositionSize(accountBalance, entryPrice, stopLoss) {
  const riskAmount = accountBalance * (CONFIG.ACCOUNT_RISK_PERCENT / 100);
  const priceDifference = Math.abs(entryPrice - stopLoss);
  if (priceDifference === 0) return { positionSize: "0", dollarValue: "0", riskAmount: "0", recommendedLeverage: 1 };
  
  const positionSize = riskAmount / priceDifference;
  
  // رافعة مالية مرنة وآمنة بناءً على قرب الستوب لوز لحماية الرصيد
  let recommendedLeverage = Math.floor((positionSize * entryPrice) / accountBalance);
  if (recommendedLeverage < 1) recommendedLeverage = 1;
  if (recommendedLeverage > 10) recommendedLeverage = 10; // كحد أقصى للحماية من الانزلاق السعري
  
  return { 
    positionSize: positionSize.toFixed(3), 
    dollarValue: (positionSize * entryPrice).toFixed(2), 
    riskAmount: riskAmount.toFixed(2), 
    recommendedLeverage 
  };
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
    const entryPrice1 = last.close;
    
    // 🎯 ميزة الدخول المجزأ (DCA): الدخول الثاني يكون أفضل بـ 0.3% لضمان اقتناص الارتدادات
    const entryPrice2 = isLong ? entryPrice1 * 0.997 : entryPrice1 * 1.003;

    const sl = isLong ? entryPrice1 - (atr * 1.2) : entryPrice1 + (atr * 1.2);
    const tp1 = isLong ? entryPrice1 + atr * 1.2 : entryPrice1 - atr * 1.2;
    const tp2 = isLong ? entryPrice1 + atr * 2.2 : entryPrice1 - atr * 2.2;
    const tp3 = isLong ? entryPrice1 + atr * 3.5 : entryPrice1 - atr * 3.5;

    const position = calculatePositionSize(10000, entryPrice1, sl);

    let category = 'MAJOR';
    if (CATEGORIES.ALPHA.includes(coin)) category = 'ALPHA 🚀';
    if (CATEGORIES.MEME.includes(coin)) category = 'MEME 🐶';

    // صياغة الرسالة الماستر كلاس الإرشادية الجديدة
    const msg = `🏦 *QUANT FLASH SIGNAL (5m)* 🏦
━━━━━━━━━━━━━━━━━━━━
📊 *القسم:* ${category}
🪙 *العملة:* ${coin}/USDT
🎯 *التوجيه:* ${isLong ? 'LONG 📈' : 'SHORT 📉'}
⚖️ *الرافعة الموصى بها:* \`${position.recommendedLeverage}x\`
📊 *قوة الفلترة:* \`${score}/100\`

🧱 *مناطق الدخول (على أجزاء):*
• دوتة 1 (الآن): \`$${formatPrice(entryPrice1, coin)}\`
• دوتة 2 (معلق): \`$${formatPrice(entryPrice2, coin)}\`

🎯 *الأهداف التكتيكية:*
• 🎯 TP1: \`$${formatPrice(tp1, coin)}\`
• 🎯 TP2: \`$${formatPrice(tp2, coin)}\`
• 🎯 TP3: \`$${formatPrice(tp3, coin)}\`

🛑 *إيقاف الخسارة:* \`$${formatPrice(sl, coin)}\`

⚙️ *إدارة رأس المال:* ريسك ${CONFIG.ACCOUNT_RISK_PERCENT}% | حجم العقد: ${position.positionSize} ${coin}
⚠️ *تنبيه حماية:* بمجرد ضرب *TP1*، انقل الستوب فوراً إلى سعر الدخول لتأمين الصفقة مجاناً 🛡️

🏆 *AI Flash Sniper Engine V15.5*`;

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
    [{ text: "🔥 أفضل 5 صعوداً", callback_data: "cmd_top" }, { text: "📊 مؤشر الخوف", callback_data: "cmd_fear" }],
    [{ text: "🏦 فحص الكبرى مانيوال", callback_data: "scan_major" }, { text: "🚀 فحص الألفا مانيوال", callback_data: "scan_alpha" }],
    [{ text: "🐶 فحص الميم مانيوال", callback_data: "scan_meme" }, { text: "📈 الإحصائيات الحالية", callback_data: "cmd_stats" }]
  ]
};

function getSubscribeKeyboard(inviteLink) {
  return {
    inline_keyboard: [
      [{ text: "📢 انضم للقناة", url: inviteLink || `https://t.me/c/${TELEGRAM_CHAT_ID.replace('-100', '')}` }],
      [{ text: "✅ تم الانضمام", callback_data: "check_sub" }]
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
      let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
      let lastCat = await kv?.get('LAST_SCANNED_CATEGORY') || 'None';
      return new Response(`<h1>🏦 V15.5 MASTER-CLASS ACTIVE</h1><p>Signals Dispatched: ${stats.total}</p>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
              await sendTelegram(token, chatId, `🎉 *تم التفعيل! المحرك الماستر كلاس V15.5 شغال الآن تلقائياً.*`, MENU_KEYBOARD);
            }
            return new Response('OK');
          }

          const isSubbed = await checkChannelSubscription(token, userId);
          if (!isSubbed) return new Response('OK');

          if (data === 'scan_major') {
            await sendTelegram(token, chatId, `🔍 فحص مانيوال طارئ للعملات الكبرى...`);
            ctx.waitUntil(marketScanner(token, kv, 'MAJOR'));
          } else if (data === 'scan_alpha') {
            await sendTelegram(token, chatId, `🚀 فحص مانيوال طارئ لعملات الألفا...`);
            ctx.waitUntil(marketScanner(token, kv, 'ALPHA'));
          } else if (data === 'scan_meme') {
            await sendTelegram(token, chatId, `🐶 فحص مانيوال طارئ لعملات الميم...`);
            ctx.waitUntil(marketScanner(token, kv, 'MEME'));
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
            await sendTelegram(token, chatId, `🏦 *TRADING AI V15.5 QUANT PRO* 🏦\n━━━━━━━━━━━━━━━━━━━━━\nتم تفعيل الـ 5m ونظام الدخول المجزأ والـ Leverage الذكي الموصى به.`, MENU_KEYBOARD);
            return new Response('OK');
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
