/**
 * Sends a message to a Telegram chat.
 * Uses the native global fetch API (Node 18+).
 */
export async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN environment variable is not defined.');
    return false;
  }
  
  if (!chatId) {
    console.warn('Cannot send Telegram message: chatId is empty.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      console.error(`Telegram API error (status ${response.status}):`, errorMsg);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to connect to Telegram API:', err);
    return false;
  }
}
