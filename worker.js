export default {
  async fetch(request, env) {

    if (request.method !== "POST") {
      return new Response("Trading AI V9 Bot Online");
    }

    const update = await request.json();

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      let reply = "أهلاً بك في Trading AI V9";

      if (text === "/start") {
        reply = "🚀 البوت يعمل بنجاح";
      }

      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply
          })
        }
      );
    }

    return new Response("OK");
  }
};
