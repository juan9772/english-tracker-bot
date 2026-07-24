import { getState, saveState } from './_db.js';
import { sendTelegramMessage } from './_telegram.js';
import { getLocalDateString, getPreviousDateString, getLocalDateParts, getDayOfWeek } from './_time.js';
import { processQueue } from './_queue.js';

function respond(res, code, body) {
  if (typeof res?.status === 'function') {
    if (typeof body === 'object') return res.status(code).json(body);
    return res.status(code).send(body);
  }
  if (res) {
    res.statusCode = code;
    if (typeof body === 'object') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(body));
    }
    return res.end(String(body));
  }
}

export default async function handler(req, res) {
  // Verify Cron authorization in production
  const authHeader = req.headers ? req.headers.authorization : null;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.MOCK_KV !== 'true') {
      return respond(res, 401, { error: 'Unauthorized' });
    }
  }

  try {
    const state = await getState();

    // Process any messages in the queue first
    await processQueue(state);

    const announcementChatId = state.chatId || process.env.TELEGRAM_CHAT_ID;
    
    // Check if User B is configured
    const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB.username || state.users.userB.id);

    const usersToProcess = [
      { key: 'userA', user: state.users.userA }
    ];
    if (isUserBActive) {
      usersToProcess.push({ key: 'userB', user: state.users.userB });
    }

    let stateChanged = false;
    const messagesToSend = [];

    for (const { key, user } of usersToProcess) {
      const now = new Date();
      const currentDateStr = getLocalDateString(now, user.timezone);
      const previousDateStr = getPreviousDateString(currentDateStr);
      const parts = getLocalDateParts(now, user.timezone);
      const localDayOfWeek = getDayOfWeek(currentDateStr); // 1 = Monday

      // 1. Check for Monday weekly shield reset
      if (localDayOfWeek === 1 && user.lastShieldResetDate !== currentDateStr) {
        user.shields = 2;
        user.lastShieldResetDate = currentDateStr;
        stateChanged = true;
        
        messagesToSend.push({
          chatId: announcementChatId,
          text: `✨ <b>¡Comienza una nueva semana!</b> Los escudos de <b>${user.name}</b> se han restablecido a <b>2</b>. 🛡️ ¡Úsalos con sabiduría!\n\n<i>English tip:</i> "A fresh start is a clean slate. Make this week count!" 🚀`
        });
      }

      // 2. Safety Net: If never evaluated, set it to previousDateStr to avoid retro-penalizing
      if (!user.lastEvaluatedDate) {
        user.lastEvaluatedDate = previousDateStr;
        stateChanged = true;
        continue;
      }

      // 3. Process midnight evaluation
      // If the user's lastEvaluatedDate is not the previous day, it means we transitioned
      // past midnight into a new day (or multiple days if bot was down) and need to evaluate compliance
      if (user.lastEvaluatedDate !== previousDateStr) {
        // Did the user check in or manually use a shield for previousDateStr?
        const completed = user.lastCheckIn === previousDateStr || user.lastShieldUsedDate === previousDateStr;

        if (completed) {
          // All good! No penalty. Just progress the evaluation date.
          user.lastEvaluatedDate = previousDateStr;
          stateChanged = true;
          console.log(`User ${key} completed their task on ${previousDateStr}. No action needed.`);
        } else {
          // Failed to complete task. Let's see if we can save them with a shield.
          if (user.shields > 0) {
            user.shields -= 1;
            user.lastShieldUsedDate = previousDateStr;
            user.lastEvaluatedDate = previousDateStr;
            stateChanged = true;

            messagesToSend.push({
              chatId: announcementChatId,
              text: `⚠️ <b>${user.name}</b> no registró su frase de inglés ayer... ¡Pero se ha salvado usando un escudo automático! 🛡️ Le quedan <b>${user.shields} escudos</b> para esta semana.\n\n<i>English reminder:</i> "Don't let the streak break! Try to practice today!" ✍️`
            });
          } else {
            // No shields left. Streak resets to 0!
            const oldStreak = user.streak;
            user.streak = 0;
            user.lastEvaluatedDate = previousDateStr;
            stateChanged = true;

            const PENALTIES = [
              "comprarle un café al otro ☕ (transferir dinero por Mercado Pago o Paypal).",
              "mandarle un regalito o comida sorpresa por PedidosYa, Rappi o UberEats 🍕.",
              "grabar un audio cantando 30 segundos de una canción en inglés elegida por el ganador 🎤 y mandarlo al grupo.",
              "grabar un audio de 1 minuto leyendo un texto en inglés con un acento británico o de Shakespeare exagerado 🎭.",
              "cambiar su foto de perfil de Telegram por un meme elegido por el ganador por 24 horas 🖼️."
            ];
            const randomPenalty = PENALTIES[Math.floor(Math.random() * PENALTIES.length)];

            messagesToSend.push({
              chatId: announcementChatId,
              text: `🚨💥 <b>¡LA CONSTANCIA SE HA ROTO!</b> 💥🚨\n\n` +
                `<b>${user.name}</b> no completó su práctica de inglés ayer y no le quedaban escudos. 😱\n\n` +
                `Su racha de <b>${oldStreak} días</b> se ha desplomado a <b>0</b>. 😭\n\n` +
                `⚡ <b>PENALIZACIÓN:</b> Deberá <b>${randomPenalty}</b>\n\n` +
                `<i>English lesson:</i> "Consistency is hard, but excuses don't build habits. Pay the price and start again!" 💀`
            });
          }
        }
      }
    }

    // Always add a friendly cron execution notification message if chatId is available
    if (announcementChatId) {
      messagesToSend.push({
        chatId: announcementChatId,
        text: `⏰ <b>[Verificación Diaria]</b> 🤖\n\nEl bot ha ejecutado la revisión de constancia y procesado la cola de mensajes con éxito. ¡A seguir practicando! 💪\n\n<i>Daily reminder:</i> "Don't stop until you're proud! 🚀"`
      });
    }

    if (stateChanged) {
      await saveState(state);
    }

    // Send accumulated notifications outside the loop
    for (const msg of messagesToSend) {
      if (msg.chatId) {
        await sendTelegramMessage(msg.chatId, msg.text);
      } else {
        console.warn('Skipped sending telegram announcement: No chatId available in state/env.');
      }
    }

    return respond(res, 200, { success: true, evaluated: usersToProcess.map(u => u.key) });
  } catch (err) {
    console.error('Fatal error in cron handler:', err);
    return respond(res, 500, { error: 'Internal Server Error', details: err.message });
  }
}
