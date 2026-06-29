// ============================================================
// 🏆 TRADING BOT V11 - ULTIMATE EDITION (WORKING)
// ============================================================

const BOT_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI';

// ======================= الإعدادات =======================
const CONFIG = {
  MAX_SIGNALS_PER_DAY: 5,
  MIN_RISK_REWARD: 2.0,
  SCORE_STRONG: 90,
  SCORE_BUY: 80,
  ANTI_SPAM_MS: 1500,
  CACHE_TTL_MS: 300000,
  BATCH_SIZE: 3,
  DELAY: 500,
  KILL_ZONES: {
    LONDON: { start: 7, end: 10 },
    NEW_YORK: { start: 13, end: 16 },
    ASIA: { start: 22, end: 2 }
  }
};

// ======================= القوائم =======================
const WATCH_LIST = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 
  'LINK', 'MATIC', 'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR'
];

// ======================= الأدوات المساعدة =======================
const delay = ms => new Promise(r => setTimeout(r, ms));

async function sendTelegram(chatId, text, keyboard = null) {
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
    console.error('Send error:', e);
  }
}

// ======================= المؤشرات =======================
class AdvancedIndicators {
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

  static ema(data, period) {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let e = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  }
}

// ======================= جلب البيانات =======================
async function getData(symbol, interval = '15m', limit = 100) {
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
      vol: +c[5]
    }));
  } catch { return null; }
}

// ======================= SMC =======================
class AdvancedSMC {
  static detectLiquidity(data) {
    if (data.length < 50) return { sweeps: [], hasSweep: false };
    
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
        swingHighs.push({ price: highs[i], index: i });
      }
      if (isLow) {
        swingLows.push({ price: lows[i], index: i });
      }
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
        if (sizePips >= 3) {
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
        if (sizePips >= 3) {
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
}

// ======================= الفحص =======================
async function scanCoins() {
  const signals = [];
  
  for (const coin of WATCH_LIST) {
    try {
      const symbol = coin + 'USDT';
      const data = await getData(symbol, '15m', 100);
      if (!data) continue;
      
      const currentPrice = data[data.length - 1].close;
      const atr = AdvancedIndicators.calculateATR(data);
      
      // Liquidity Sweep
      const liquidity = AdvancedSMC.detectLiquidity(data);
      
      // FVG
      const fvg = AdvancedSMC.detectFVG(data);
      
      // حساب النتيجة
      let score = 0;
      let reasons = [];
      let direction = 'NEUTRAL';
      
      if (liquidity.hasSweep) {
        const sweep = liquidity.strongestSweep;
        if (sweep.type === 'BUY') {
          score += 30;
          reasons.push('🦅 Liquidity Sweep صاعد');
          direction = 'LONG';
        } else if (sweep.type === 'SELL') {
          score += 30;
          reasons.push('🦅 Liquidity Sweep هابط');
          direction = 'SHORT';
        }
      }
      
      if (fvg && !fvg.isMitigated) {
        if (fvg.type === 'BULLISH') {
          score += 20;
          reasons.push('📊 FVG صاعد');
          direction = 'LONG';
        } else if (fvg.type === 'BEARISH') {
          score += 20;
          reasons.push('📊 FVG هابط');
          direction = 'SHORT';
        }
      }
      
      // حساب الأهداف
      let tp1, tp2, tp3, sl;
      if (atr && atr > 0) {
        if (direction === 'LONG') {
          tp1 = currentPrice + (atr * 1.5);
          tp2 = currentPrice + (atr * 2.5);
          tp3 = currentPrice + (atr * 3.5);
          sl = currentPrice - (atr * 1);
        } else if (direction === 'SHORT') {
          tp1 = currentPrice - (atr * 1.5);
          tp2 = currentPrice - (atr * 2.5);
          tp3 = currentPrice - (atr * 3.5);
          sl = currentPrice + (atr * 1);
        }
      }
      
      const rr = direction === 'LONG' ? ((tp3 - currentPrice) / (currentPrice - sl)) : ((currentPrice - tp3) / (sl - currentPrice));
      
      if (score >= CONFIG.SCORE_BUY && rr >= CONFIG.MIN_RISK_REWARD && direction !== 'NEUTRAL') {
        signals.push({
          coin,
          direction,
          entry: currentPrice,
          tp1, tp2, tp3, sl,
          score,
          rr,
          reasons,
          exchange: 'Binance'
        });
      }
      
    } catch (e) {
      console.error(`Error scanning ${coin}:`, e);
    }
  }
  
  return signals;
}

// ======================= Dashboard =======================
function getDashboardHTML(signals) {
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
      .badge{display:inline-block;padding:2px 12px;border-radius:20px;font-size:11px;font-weight:bold}
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
        <div style="color:#666;font-size:14px">Multi-Exchange Ultimate Edition • SMC/ICT</div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card"><div class="label">📊 الإشارات</div><div class="value gold">${signals.length}</div></div>
        <div class="stat-card"><div class="label">🟢 LONG</div><div class="value green">${signals.filter(s => s.direction === 'LONG').length}</div></div>
        <div class="stat-card"><div class="label">🔴 SHORT</div><div class="value red">${signals.filter(s => s.direction === 'SHORT').length}</div></div>
        <div class="stat-card"><div class="label">⚡ نشطة</div><div class="value blue">0</div></div>
      </div>
      
      <div class="card">
        <h3>⚡ آخر الإشارات</h3>
        <table>
          <thead><tr><th>العملة</th><th>النوع</th><th>الدخول</th><th>TP1</th><th>TP2</th><th>TP3</th><th>SL</th><th>R/R</th></tr></thead>
          <tbody>
            ${signals.map(s => `
              <tr>
                <td><strong>${s.coin}</strong></td>
                <td><span class="badge ${s.direction === 'LONG' ? 'badge-long' : 'badge-short'}">${s.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}</span></td>
                <td>$${s.entry?.toFixed(6)}</td>
                <td>$${s.tp1?.toFixed(6)}</td>
                <td>$${s.tp2?.toFixed(6)}</td>
                <td>$${s.tp3?.toFixed(6)}</td>
                <td>$${s.sl?.toFixed(6)}</td>
                <td>1:${s.rr?.toFixed(2)}</td>
              </tr>
            `).join('')}
            ${signals.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:#666">لا توجد إشارات حالياً</td></tr>' : ''}
          </tbody>
        </table>
      </div>
      
      <div class="footer">V11.0 Multi-Exchange Ultimate Edition • ${new Date().toLocaleString()}</div>
    </div>
  </body>
  </html>`;
}

// ======================= الـ Handler الرئيسي =======================
export default {
  async scheduled(event, env, ctx) {
    // الفحص التلقائي
    ctx.waitUntil(async () => {
      const signals = await scanCoins();
      if (signals.length > 0) {
        for (const signal of signals) {
          const emoji = signal.score >= 90 ? '🟢' : '🟡';
          const type = signal.score >= 90 ? 'STRONG BUY' : 'BUY';
          
          let msg = `${emoji} *${type} - ${signal.score}%*\n`;
          msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `🪙 *${signal.coin}/USDT*\n`;
          msg += `🎯 *${signal.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
          msg += `💰 *$${signal.entry.toFixed(6)}*\n\n`;
          msg += `🎯 TP1: *$${signal.tp1.toFixed(6)}*\n`;
          msg += `🎯 TP2: *$${signal.tp2.toFixed(6)}*\n`;
          msg += `🎯 TP3: *$${signal.tp3.toFixed(6)}*\n`;
          msg += `🛑 SL: *$${signal.sl.toFixed(6)}*\n\n`;
          msg += `📌 *الأسباب:*\n${signal.reasons.join("\n")}\n`;
          msg += `⚡ *V11.0 Multi-Exchange Ultimate*`;
          
          await sendTelegram('@mrcrypto166', msg);
        }
      }
    });
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ====== TEST ======
    if (url.pathname === '/test') {
      return new Response(JSON.stringify({
        status: '✅ Worker شغال!',
        token: BOT_TOKEN ? '✅ موجود' : '❌ غير موجود',
        watchList: WATCH_LIST.length,
        time: new Date().toISOString()
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ====== DASHBOARD ======
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      const signals = await scanCoins();
      return new Response(getDashboardHTML(signals), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ====== SCAN ======
    if (url.pathname === '/scan') {
      ctx.waitUntil(async () => {
        const signals = await scanCoins();
        if (signals.length > 0) {
          for (const signal of signals) {
            const emoji = signal.score >= 90 ? '🟢' : '🟡';
            const type = signal.score >= 90 ? 'STRONG BUY' : 'BUY';
            
            let msg = `${emoji} *${type} - ${signal.score}%*\n`;
            msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `🪙 *${signal.coin}/USDT*\n`;
            msg += `🎯 *${signal.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
            msg += `💰 *$${signal.entry.toFixed(6)}*\n\n`;
            msg += `🎯 TP1: *$${signal.tp1.toFixed(6)}*\n`;
            msg += `🎯 TP2: *$${signal.tp2.toFixed(6)}*\n`;
            msg += `🎯 TP3: *$${signal.tp3.toFixed(6)}*\n`;
            msg += `🛑 SL: *$${signal.sl.toFixed(6)}*\n\n`;
            msg += `📌 *الأسباب:*\n${signal.reasons.join("\n")}\n`;
            msg += `⚡ *V11.0 Multi-Exchange Ultimate*`;
            
            await sendTelegram('@mrcrypto166', msg);
          }
        }
      });
      return new Response('🔍 جاري الفحص...', { status: 200 });
    }

    // ====== WEBHOOK ======
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();

        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text.trim();

          if (text === '/start') {
            await sendTelegram(chatId,
              `🤖 *TRADING AI PRO V11.0*\n━━━━━━━━━━━━━━━━━━━━━\n✅ *البوت شغال!*\n\n🔹 *الأوامر:*\n/start - للبدء\n/menu - القائمة\n/scan - فحص فوري\n/dashboard - لوحة التحكم\n\n📊 Dashboard: https://trading-ai-v9.elsayedelhendawy15.workers.dev/dashboard`
            );
          } else if (text === '/menu') {
            await sendTelegram(chatId, '📋 *القائمة الرئيسية*\n\n/start - للبدء\n/scan - فحص فوري\n/dashboard - لوحة التحكم');
          } else if (text === '/scan') {
            ctx.waitUntil(async () => {
              const signals = await scanCoins();
              if (signals.length > 0) {
                for (const signal of signals) {
                  const emoji = signal.score >= 90 ? '🟢' : '🟡';
                  const type = signal.score >= 90 ? 'STRONG BUY' : 'BUY';
                  
                  let msg = `${emoji} *${type} - ${signal.score}%*\n`;
                  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
                  msg += `🪙 *${signal.coin}/USDT*\n`;
                  msg += `🎯 *${signal.direction === 'LONG' ? 'LONG 📈' : 'SHORT 📉'}*\n`;
                  msg += `💰 *$${signal.entry.toFixed(6)}*\n\n`;
                  msg += `🎯 TP1: *$${signal.tp1.toFixed(6)}*\n`;
                  msg += `🎯 TP2: *$${signal.tp2.toFixed(6)}*\n`;
                  msg += `🎯 TP3: *$${signal.tp3.toFixed(6)}*\n`;
                  msg += `🛑 SL: *$${signal.sl.toFixed(6)}*\n\n`;
                  msg += `📌 *الأسباب:*\n${signal.reasons.join("\n")}\n`;
                  msg += `⚡ *V11.0 Multi-Exchange Ultimate*`;
                  
                  await sendTelegram(chatId, msg);
                }
              } else {
                await sendTelegram(chatId, '📭 لا توجد إشارات حالياً');
              }
            });
            await sendTelegram(chatId, '🔍 *جاري الفحص...*\n⏳ انتظر لحظة');
          } else if (text === '/dashboard') {
            await sendTelegram(chatId, `📊 *Dashboard*\nhttps://trading-ai-v9.elsayedelhendawy15.workers.dev/dashboard`);
          } else {
            await sendTelegram(chatId, `📋 استخدم /start للقائمة الرئيسية`);
          }
        }

        return new Response('OK');
      } catch (e) {
        console.error('Webhook error:', e);
        return new Response('Error: ' + e.message, { status: 500 });
      }
    }

    return new Response('404 Not Found', { status: 404 });
  }
};
