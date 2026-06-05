// Trading AI Pro V13 - نسخة العمل النهائية
const TOKEN = '8915873552:AAEWPlRdl65nKWA3Ksnbj0yc11A97eX2qCI';
const CHAT_ID = '-1003591113059';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // مسار لوحة التحكم
    if (url.pathname === '/dashboard' || url.pathname === '/') {
      return new Response('🧠 Trading AI Pro V13 AI\n✅ Bot is running\n📊 Dashboard Active', { status: 200 });
    }

    // ⚠️ هذا هو المسار الحاسم ⚠️
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        console.log('Webhook received:', update); // للتأكد من وصول الطلبات (شوف الـ Logs)

        if (update.message && update.message.text) {
          const chatId = update.message.chat.id;
          const messageText = update.message.text;

          let replyText = '';
          if (messageText === '/start') {
            replyText = '🧠 *V13 AI Bot* 🧠\n━━━━━━━━━━━━━━━━━━━━\n✅ البوت شغال وجاهز للإشارات!\n🤖 AI Threshold: 70%\n📊 Dashboard: https://trading-ai-v9.elsayedelhendawy15.workers.dev/dashboard';
          } else {
            replyText = `✅ استقبلت أمرك: ${messageText}`;
          }

          // إرسال الرد
          await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' })
          });
        }
        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error('Error:', err);
        return new Response('Error', { status: 500 });
      }
    }

    // أي مسار آخر
    return new Response('Not Found', { status: 404 });
  }
};
