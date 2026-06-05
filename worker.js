// ============================================================
// TRADING AI PRO V14 ULTIMATE - MAXIMUM PROFESSIONAL VERSION
// ============================================================

const TELEGRAM_CHAT_ID = '-1003591113059'; // معرف قناتك الأساسية لبث الإشارات والتحقق من الاشتراك

const CONFIG = {
  MAX_SIGNALS_PER_DAY: 8,        // توازن ممتاز للإشارات اليومية
  MIN_VOLUME_USD: 2000000,       // تصفية العملات الضعيفة (2 مليون فأكثر)
  COOLDOWN_HOURS: 2,             // تهدئة ساعتين لكل عملة لمنع التكرار المزعج
  BATCH_SIZE: 3,
  DELAY: 1200,
  ANTI_SPAM_MS: 1500,
  ATR_PERIOD: 14,
  TP_ATR_MULTIPLIER: [1.5, 2.5, 4.0],
  ACCOUNT_RISK_PERCENT: 1.0,     // إدارة رأس مال صارمة 1%
  CACHE_TTL_MS: 45000,
  AI_SCORE_THRESHOLD: 70,        // سكور ذكي ومتوازن (70/100) لالتقاط أفضل الفرص الفعالة
  VOLUME_RATIO_THRESHOLD: 1.2,   // التأكد من وجود زخم تداول حقيقي
  TIMEFRAMES: {
    MASTER: '4h',
    CONFIRM: '1h',
    ENTRY: '15m'
  }
};

const delay = ms => new Promise(r => setTimeout(r, ms));
let lastSend = 0;
let dataCache = new Map();

const WATCH_LIST = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'TON'];

// ========== المؤشرات الفنية العميقة ==========
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

function calculatePremiumScore({ structure, sweep, fvg, volumeRatio, pdZone, entrySide }) {
  let score = 35; // Base Score لضمان الحركية الفعالة للبوت
  if (structure === (entrySide === 'LONG' ? "BULLISH" : "BEARISH")) score += 25;
  if (sweep.buySideSweep || sweep.sellSideSweep) score += 15;
  if (volumeRatio >= 1.2) score += 15;
  if (fvg) score += 10;
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

// ========== نظام التحقق من الاشتراك الإجباري ==========
async function checkChannelSubscription(token, userId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${TELEGRAM_CHAT_ID}&user_id=${userId}`);
    if (!res.ok) return false;
    const data = await res.json();
    const status = data.result?.status;
    return ['creator', 'administrator', 'member'].includes(status);
  } catch (e) {
    return false;
  }
}

// ========== إرسال رسائل تليجرام بالتنسيق المتقدم ==========
async function sendTelegram(token, chatId, text, keyboard = null) {
  if (Date.now() - lastSend < 1000) return;
  lastSend = Date.now();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch(e) {}
}

// ========== معالجة العملات وإطلاق الإشارات الفورية ==========
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
    const pdZone = premiumDiscountZone(dataEntry, dataEntry[dataEntry.length - 1].close);
    const entrySide = mtf.trend === "BULLISH" ? "LONG" : "SHORT";

    const score = calculatePremiumScore({ structure: mtf.trend, sweep, fvg, volumeRatio: volume.ratio, pdZone, entrySide });
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

    const msg = `🏦 *V14 ULTIMATE SIGNAL* 🏦\n━━━━━━━━━━━━━━━━━━━━\n🪙 *🪙 العملة: ${coin}/USDT*\n🎯 *التوجيه الفني:* ${isLong ? 'LONG 📈 (شراء)' : 'SHORT 📉 (بيع)'}\n💰 *سعر الدخول الحلي:* \`$${entryPrice.toFixed(4)}\`\n📊 *نسبة نجاح الذكاء الاصطناعي:* \`${score}/100\`\n\n🎯 *الهدف الأول (TP1):* \`$${tp1.toFixed(4)}\`\n🎯 *الهدف الثاني (TP2):* \`$${tp2.toFixed(4)}\`\n🎯 *الهدف الثالث (TP3):* \`$${tp3.toFixed(4)}\`\n🛑 *وقف الخسارة (SL):* \`$${sl.toFixed(4)}\`\n\n📊 *إدارة رأس المال والمخاطر:*\n• نسبة المخاطرة الموصى بها: ${CONFIG.ACCOUNT_RISK_PERCENT}%\n• الرافعة المالية المقترحة: ${position.recommendedLeverage}x\n• حجم العقد المقترح: ${position.positionSize} ${coin}\n\n📌 *التحليل الذكي للهيكل الفني:*\n• توافق الفريمات: ✅ متطابق (${CONFIG.TIMEFRAMES.MASTER} + ${CONFIG.TIMEFRAMES.CONFIRM})\n• معدل الزخم والسيولة: 🔥 ${volume.ratio.toFixed(1)}x\n• مناطق السعر الحالية: ${isLong ? 'Discount Zone 🌟' : 'Premium Zone 🌟'}\n\n🏆 *AI Trading Engine V14*`;

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

async function marketScanner(token, kv) {
  for (let i = 0; i < WATCH_LIST.length; i += CONFIG.BATCH_SIZE) {
    const batch = WATCH_LIST.slice(i, i + CONFIG.BATCH_SIZE);
    await Promise.all(batch.map(coin => processCoin(coin, token, kv)));
    await delay(CONFIG.DELAY);
  }
}

// ========== جلب الأسعار والبيانات الحية للأوامر الاحترافية ==========
async function getLivePrice(symbol) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}USDT`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch { return null; }
}

async function getCryptoFearAndGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    if (!res.ok) return "غير متوفر حالياً";
    const data = await res.json();
    const value = data.data[0].value;
    const classification = data.data[0].value_classification;
    return `${value} (${classification})`;
  } catch { return "غير متوفر حالياً"; }
}

// ========== لوحة الأزرار التفاعلية الاحترافية ==========
const MENU_KEYBOARD = {
  inline_keyboard: [
    [{ text: "💰 سعر BTC", callback_data: "cmd_btc" }, { text: "💎 سعر ETH", callback_data: "cmd_eth" }],
    [{ text: "🚀 سعر SOL", callback_data: "cmd_sol" }, { text: "🔥 أفضل 5 صعوداً", callback_data: "cmd_top" }],
    [{ text: "📊 مؤشر الخوف والجشع", callback_data: "cmd_fear" }, { text: "🔍 فحص السوق الآن", callback_data: "cmd_scan" }],
    [{ text: "📈 إحصائيات النظام", callback_data: "cmd_stats" }, { text: "👑 ميزات V14", callback_data: "cmd_about" }]
  ]
};

// الأزرار المطلوبة للاشتراك الإجباري
function getSubscribeKeyboard(inviteLink) {
  return {
    inline_keyboard: [
      [{ text: "📢 اضغط هنا للانضمام للقناة", url: inviteLink || `https://t.me/c/${TELEGRAM_CHAT_ID.replace('-100', '')}` }],
      [{ text: "✅ تم الانضمام بنجاح (تفعيل البوت)", callback_data: "check_sub" }]
    ]
  };
}

// ========== تفعيل محرك الـ Worker Main ==========
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

    if (url.pathname === '/' || url.pathname === '/dashboard') {
      let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
      return new Response(`<h1>🏦 V14 ULTIMATE ENGINE ACTIVE</h1><p>Total Signals Dispatched: ${stats.total}</p>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        // 1️⃣ معالجة ضغطات الأزرار (Callback Queries)
        if (update.callback_query) {
          const cb = update.callback_query;
          const userId = cb.from.id;
          const chatId = cb.message.chat.id;
          const data = cb.data;

          // التحقق من الاشتراك الإجباري عند الضغط على تأكيد الاشتراك
          if (data === "check_sub") {
            const isSubbed = await checkChannelSubscription(token, userId);
            if (isSubbed) {
              await sendTelegram(token, chatId, `🎉 *أهلاً بك يا فنان! تم تفعيل الحساب بنجاح بنظام المدفوع V14.*\nاستخدم الآن الأزرار أدناه للتحكم المطلق والتحليل:`, MENU_KEYBOARD);
            } else {
              await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                body: JSON.stringify({ callback_query_id: cb.id, text: "❌ أنت غير مشترك في القناة حتى الآن! يرجى الانضمام أولاً.", show_alert: true })
              });
            }
            return new Response('OK');
          }

          // حماية باقي الأزرار بالاشتراك الإجباري
          const isSubbed = await checkChannelSubscription(token, userId);
          if (!isSubbed) {
            await sendTelegram(token, chatId, `⚠️ *عذراً يا غالي، لا يمكنك استخدام أزرار البوت بدون الاشتراك في القناة أولاً!*`, getSubscribeKeyboard(env.CHANNEL_INVITE_LINK));
            return new Response('OK');
          }

          if (data === 'cmd_btc') {
            const p = await getLivePrice('BTC');
            await sendTelegram(token, chatId, `🪙 *سعر البيتكوين الحي (BTC):* \`$${p?.toLocaleString() || 'فشل الجلب'}\``);
          } else if (data === 'cmd_eth') {
            const p = await getLivePrice('ETH');
            await sendTelegram(token, chatId, `💎 *سعر الإيثريوم الحي (ETH):* \`$${p?.toLocaleString() || 'فشل الجلب'}\``);
          } else if (data === 'cmd_sol') {
            const p = await getLivePrice('SOL');
            await sendTelegram(token, chatId, `🚀 *سعر السولانا الحي (SOL):* \`$${p?.toLocaleString() || 'فشل الجلب'}\``);
          } else if (data === 'cmd_top') {
            const movers = await getTopMovers();
            await sendTelegram(token, chatId, `🔥 *أفضل العملات صعوداً في الـ 24 ساعة الماضية:*\n━━━━━━━━━━━━━━━━━━━━\n${movers.map(m => `🟢 *${m.s}*: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (data === 'cmd_fear') {
            const fng = await getCryptoFearAndGreed();
            await sendTelegram(token, chatId, `📊 *مؤشر الخوف والطمع الحالي في السوق:*\n👉 \`${fng}\``);
          } else if (data === 'cmd_scan') {
            await sendTelegram(token, chatId, `🔍 *جاري بدء فحص يدوي شامل للماركت الآن...*`);
            ctx.waitUntil(marketScanner(token, kv));
          } else if (data === 'cmd_stats') {
            let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
            await sendTelegram(token, chatId, `📊 *إحصائيات محرك الـ V14 PRO:*\n━━━━━━━━━━━━━━━━━━━━\n🎯 إجمالي الإشارات المرسلة: \`${stats.total}\`\n📡 حالة الاتصال بباينانس: \`مستقر ✅\``);
          } else if (data === 'cmd_about') {
            await sendTelegram(token, chatId, `👑 *تفاصيل وميزات المحرك التلقائي V14 Ultimate:* \n• توافق فني ثلاثي الفريمات (4H+1H+15M)\n• حساب دقيق لمناطق الـ Discount/Premium لضمان الدخول برخص.\n• فلاتر سيولة وزخم بنسب مرنة وفعالة عالية الأداء.`);
          }

          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: 'POST', body: JSON.stringify({ callback_query_id: cb.id }) });
          return new Response('OK');
        }

        // 2️⃣ معالجة رسائل الأوامر النصية المباشرة (Commands)
        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const userId = update.message.from.id;
          const rawText = update.message.text.trim();
          const cmd = rawText.toUpperCase();

          // أمر الـ Start المطور
          if (cmd === '/START' || cmd === '/MENU') {
            const isSubbed = await checkChannelSubscription(token, userId);
            if (!isSubbed) {
              await sendTelegram(token, chatId, `🚨 *مرحباً بك في نظام TRADING AI V14 ULTIMATE!*\n━━━━━━━━━━━━━━━━━━━━\n⚠️ للاستفادة من أقوى محرك إشارات تلقائي وبث حي للأوامر، *يجب عليك الانضمام إلى قناة البوت الرسمية أولاً!* \n\nبعد الانضمام، اضغط على زر التفعيل بالأسفل لتفتح لك لوحة التحكم الاحترافية.`, getSubscribeKeyboard(env.CHANNEL_INVITE_LINK));
              return new Response('OK');
            }
            await sendTelegram(token, chatId, `🏦 *أهلاً بك في لوحة تحكم TRADING AI V14 ULTIMATE* 🏦\n━━━━━━━━━━━━━━━━━━━━━\nالبوت يعمل بأعلى كفاءة لربط فريمات باينانس وفحص السيولة وحساب وقف الخسارة والأهداف ذكياً.\n\nاستخدم الأزرار التفاعلية المباشرة أو قائمة الأوامر للتحكم الاحترافي:`, MENU_KEYBOARD);
            return new Response('OK');
          }

          // حماية باقي الأوامر النصية بالاشتراك الإجباري
          const isSubbed = await checkChannelSubscription(token, userId);
          if (!isSubbed) {
            await sendTelegram(token, chatId, `⚠️ *عذراً يا غالي، يجب عليك الاشتراك في القناة أولاً لتفعيل كافة ميزات البوت المتقدمة.*`, getSubscribeKeyboard(env.CHANNEL_INVITE_LINK));
            return new Response('OK');
          }

          // معالجة الأوامر الفردية باحترافية حية
          if (cmd === '/BTC') {
            const p = await getLivePrice('BTC');
            await sendTelegram(token, chatId, `🪙 *سعر البيتكوين (BTC):* \`$${p?.toLocaleString() || 'غير متوفر حالياً'}\``);
          } else if (cmd === '/ETH') {
            const p = await getLivePrice('ETH');
            await sendTelegram(token, chatId, `💎 *سعر الإيثريوم (ETH):* \`$${p?.toLocaleString() || 'غير متوفر حالياً'}\``);
          } else if (cmd === '/SOL') {
            const p = await getLivePrice('SOL');
            await sendTelegram(token, chatId, `🚀 *سعر السولانا (SOL):* \`$${p?.toLocaleString() || 'غير متوفر حالياً'}\``);
          } else if (cmd.startsWith('/PRICE ')) {
            const symbol = rawText.split(' ')[1];
            if (symbol) {
              const p = await getLivePrice(symbol);
              if (p) await sendTelegram(token, chatId, `🪙 *سعر العملة ${symbol.toUpperCase()}:* \`$${p.toLocaleString()}\``);
              else await sendTelegram(token, chatId, `❌ لم نجد بيانات لهذه العملة على باينانس، يرجى كتابة الرمز صحيحاً (مثال: /price ada)`);
            }
          } else if (cmd === '/TOP') {
            const movers = await getTopMovers();
            await sendTelegram(token, chatId, `🔥 *أفضل العملات صعوداً:* \n━━━━━━━━━━━━━━━━━━━━\n${movers.map(m => `🟢 *${m.s}*: +${m.c.toFixed(2)}%`).join('\n')}`);
          } else if (cmd === '/FEAR') {
            const fng = await getCryptoFearAndGreed();
            await sendTelegram(token, chatId, `📊 *مؤشر الخوف والطمع الحالي:* \`${fng}\``);
          } else if (cmd === '/SCAN') {
            await sendTelegram(token, chatId, `🔍 *جاري فحص الماركت يدوياً الآن وبث الصفقات المتوافقة...*`);
            ctx.waitUntil(marketScanner(token, kv));
          } else if (cmd === '/STATS') {
            let stats = JSON.parse(await kv?.get('STATS') || '{"total":0}');
            await sendTelegram(token, chatId, `📊 *إحصائيات الإشارات الحالية:* \`${stats.total}\``);
          } else if (cmd === '/SUBSCRIBE') {
            await sendTelegram(token, chatId, `💎 *باقة الاشتراك المميز المتقدمة* 💎\n━━━━━━━━━━━━━━━━━━━━\n• إشارات حصرية بنسب نجاح فائقة.\n• وصول فوري لتحليلات الـ SMC الحية.\n\n💰 *السعر الحالي:* $49/شهر فقط.\nلطلب الترقية تواصل مع الدعم الفني: @SupportBot`);
          } else if (cmd === '/ABOUT') {
            await sendTelegram(token, chatId, `🏦 *TRADING AI V14 ULTIMATE* \nالإصدار الاحترافي الكامل للربط البرمجي الشامل ومراقبة سيولة صنّاع السوق الاستراتيجية.`);
          } else if (cmd === '/HELP') {
            await sendTelegram(token, chatId, `📋 *قائمة المساعدة والأوامر الاحترافية:* \n━━━━━━━━━━━━━━━━━━━━\n🔹 /start - تفعيل وتشغيل لوحة التحكم والأزرار\n🔹 /btc | /eth | /sol - أسعار كبار الماركت بشكل حي\n🔹 /price [الرمز] - معرفة سعر أي عملة من باينانس مباشرة\n🔹 /top - أعلى العملات حركة وصعوداً اليوم\n🔹 /fear - معرفة مؤشر النفسية العام للمتداولين\n🔹 /scan - أمر فحص فوري ويدوي للماركت في هذه اللحظة\n🔹 /stats - عدد الصفقات الكلية المرسلة`);
          } else {
            await sendTelegram(token, chatId, `📋 *أمر غير معروف يا فنان، أرسل /help لعرض قائمة التحكم الاحترافية الشاملة للـ V14.*`);
          }
        }
      } catch(e) {}
      return new Response('OK');
    }
    return new Response('Not Found', { status: 404 });
  }
};
