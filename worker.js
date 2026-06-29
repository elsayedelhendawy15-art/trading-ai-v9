// ========== BOT TEST VERSION ==========
const TELEGRAM_TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI'; // غير ده للتوكن الجديد

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ====== Webhook ======
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        
        // لو في رسالة
        if (update.message?.text) {
          const chatId = update.message.chat.id;
          const text = update.message.text;
          
          // رد بسيط
          let reply = 'مرحباً! البوت شغال ✅\n';
          reply += 'الأوامر المتاحة:\n';
          reply += '/start - للبدء\n';
          reply += '/menu - القائمة\n';
          reply += '/scan - فحص فوري';
          
          // إرسال رد
          await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: reply
            })
          });
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
              <h1 style="color:#00d4ff;">🤖 Trading Bot V11</h1>
              <p style="color:#888;">✅ البوت شغال!</p>
              <p style="color:#555;font-size:12px;">اطلع على الـ Logs عشان تشوف التفاصيل</p>
            </div>
          </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('404 Not Found', { status: 404 });
  }
};
