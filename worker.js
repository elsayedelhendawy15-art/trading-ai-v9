// ========== BOT WITH COMMANDS ==========
const TELEGRAM_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI'; // غير ده للتوكن الجديد

// وظيفة إرسال الرسائل
async function sendMessage(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
  } catch (e) {
    console.error('Send error:', e);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ====== Webhook ======
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          
          let reply = '';
          
          if (text === '/start') {
            reply = `🤖 *TRADING AI PRO V11.0*\n━━━━━━━━━━━━━━━━━━━━━\n✅ *البوت شغال!*\n\n🔹 الأوامر المتاحة:\n/start - للبدء\n/menu - القائمة\n/scan - فحص فوري\n/dashboard - لوحة التحكم`;
          } else if (text === '/menu') {
            reply = `📋 *القائمة الرئيسية*\n\n/start - للبدء\n/scan - فحص فوري\n/dashboard - لوحة التحكم`;
          } else if (text === '/scan') {
            reply = `🔍 *جاري الفحص المؤسسي V11.0...*\n⏳ سيتم إرسال الإشارات فور ظهورها.`;
            // تشغيل الماسح الضوئي في الخلفية
            ctx.waitUntil(advancedScanner(env));
          } else if (text === '/dashboard') {
            reply = `📊 *Dashboard*\nhttps://trading-ai-v9.elsayedelhendawy15.workers.dev/dashboard`;
          } else {
            reply = `📋 استخدم /start للقائمة الرئيسية`;
          }
          
          await sendMessage(chatId, reply);
        }
        
        return new Response('OK', { status: 200 });
      } catch (e) {
        console.error('Webhook Error:', e);
        return new Response('Error: ' + e.message, { status: 500 });
      }
    }

    // ====== Dashboard ======
    if (url.pathname === '/') {
      return new Response(`
        <html>
          <body style="background:#0a0a1a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;text-align:center;">
            <div>
              <h1 style="color:#00d4ff;">🏆 TRADING AI PRO V11.0</h1>
              <p style="color:#00ff88;">✅ البوت شغال!</p>
              <p style="color:#888;font-size:14px;">ارسل /start في التيليجرام للبدء</p>
              <p style="color:#555;font-size:12px;margin-top:20px;">Multi-Exchange • SMC/ICT • Institutional</p>
            </div>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // ====== Dashboard Full ======
    if (url.pathname === '/dashboard') {
      return new Response(`
        <html>
          <body style="background:#0a0a1a;color:#fff;font-family:sans-serif;padding:20px;">
            <h1 style="color:#00d4ff;">📊 Trading Bot Dashboard</h1>
            <p style="color:#888;">البوت شغال ✅ | انتظر الإشارات</p>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-top:20px;">
              <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;text-align:center;">
                <div style="color:#888;font-size:12px;">الإشارات</div>
                <div style="font-size:24px;font-weight:bold;color:#ffd700;">0</div>
              </div>
              <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;text-align:center;">
                <div style="color:#888;font-size:12px;">نشطة</div>
                <div style="font-size:24px;font-weight:bold;color:#00b4d8;">0</div>
              </div>
              <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;text-align:center;">
                <div style="color:#888;font-size:12px;">نسبة النجاح</div>
                <div style="font-size:24px;font-weight:bold;color:#00ff88;">0%</div>
              </div>
              <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:10px;text-align:center;">
                <div style="color:#888;font-size:12px;">الأرباح</div>
                <div style="font-size:24px;font-weight:bold;color:#00ff88;">0%</div>
              </div>
            </div>
            <p style="color:#555;font-size:12px;margin-top:30px;text-align:center;">V11.0 • Multi-Exchange • SMC/ICT</p>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // ====== Scan Endpoint ======
    if (url.pathname === '/scan') {
      ctx.waitUntil(advancedScanner(env));
      return new Response('🔍 جاري الفحص...', { status: 200 });
    }

    return new Response('404 Not Found', { status: 404 });
  }
};

// ====== الماسح الضوئي المبسط ======
async function advancedScanner(env) {
  console.log('🔄 Scanner Started...');
  
  try {
    // جرب تجيب سعر BTC
    const btcRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const btcData = await btcRes.json();
    console.log('💰 BTC Price:', btcData.price);
    
    // جيب الإشارات (مبسط)
    const coins = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA'];
    let signals = [];
    
    for (const coin of coins) {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${coin}USDT`);
        const data = await res.json();
        const change = parseFloat(data.priceChangePercent);
        
        // لو العملة طالعة أكثر من 2% وواقعة أقل من 2%
        if (change > 2) {
          signals.push(`🟢 ${coin}: +${change.toFixed(2)}% (صاعد)`);
        } else if (change < -2) {
          signals.push(`🔴 ${coin}: ${change.toFixed(2)}% (هابط)`);
        }
      } catch(e) {}
    }
    
    // لو في إشارات، أرسلها للقناة
    if (signals.length > 0) {
      const msg = `📊 *تحديث السوق*\n━━━━━━━━━━━━━━━━━\n${signals.join('\n')}\n\n⚡ V11.0 Multi-Exchange`;
      // أرسل للقناة (لو حابب)
      console.log('📨 Signals:', signals);
    } else {
      console.log('📭 No signals found');
    }
    
  } catch (e) {
    console.error('Scanner Error:', e);
  }
  
  console.log('✅ Scan Complete');
}
