import { getState, saveState } from './_db.js';
import { sendTelegramMessage } from './_telegram.js';
import { getLocalDateString, getPreviousDateString, getLocalDateParts, getDayOfWeek } from './_time.js';
import { processQueue } from './_queue.js';

/**
 * Adds 24 hours to the given YYYY-MM-DD date using UTC noon
 * to avoid daylight saving time transitions.
 */
export function getNextDateString(dateStr) {
  const localDateAtNoon = new Date(`${dateStr}T12:00:00Z`);
  const nextLocalDate = new Date(localDateAtNoon.getTime() + 24 * 60 * 60 * 1000);
  const nextYear = nextLocalDate.getUTCFullYear();
  const nextMonth = String(nextLocalDate.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(nextLocalDate.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

const PENALTIES = [
  "comprarle un café al otro ☕ (transferir dinero por Mercado Pago o Paypal).",
  "mandarle un regalito o comida sorpresa por PedidosYa, Rappi o UberEats 🍕.",
  "grabar un audio cantando 30 segundos de una canción en inglés elegida por el ganador 🎤 y mandarlo al grupo.",
  "grabar un audio de 1 minuto leyendo un texto en inglés con un acento británico o de Shakespeare exagerado 🎭.",
  "cambiar su foto de perfil de Telegram por un meme elegido por el ganador por 24 horas 🖼️."
];

/**
 * Multi-day catchup algorithm evaluating un-evaluated days sequentially
 * from lastEvaluatedDate + 1 to previousDateStr.
 */
export function evaluateMultiDayCatchup(user, currentDateStr) {
  const previousDateStr = getPreviousDateString(currentDateStr);
  if (!user.lastEvaluatedDate) {
    user.lastEvaluatedDate = previousDateStr;
    return { evaluatedDays: [], penalties: [], shieldsUsed: 0 };
  }

  const evaluatedDays = [];
  const penalties = [];
  let shieldsUsed = 0;

  let evalDate = getNextDateString(user.lastEvaluatedDate);

  while (evalDate <= previousDateStr) {
    evaluatedDays.push(evalDate);
    const evalDayOfWeek = getDayOfWeek(evalDate);

    // Monday weekly reset for intermediate Monday
    if (evalDayOfWeek === 1 && user.lastShieldResetDate !== evalDate) {
      user.shields = 2;
      user.lastShieldResetDate = evalDate;
    }

    const completed = (user.checkInHistory && (
                        Array.isArray(user.checkInHistory)
                          ? user.checkInHistory.includes(evalDate)
                          : !!user.checkInHistory[evalDate]
                      )) ||
                      (user.shieldHistory && (
                        Array.isArray(user.shieldHistory)
                          ? user.shieldHistory.includes(evalDate)
                          : !!user.shieldHistory[evalDate]
                      )) ||
                      user.lastCheckIn === evalDate ||
                      user.lastShieldUsedDate === evalDate;

    if (!completed) {
      if (user.shields > 0) {
        user.shields -= 1;
        user.lastShieldUsedDate = evalDate;
        shieldsUsed += 1;
      } else {
        const oldStreak = user.streak || 0;
        user.streak = 0;
        if (oldStreak > 0) {
          penalties.push({ date: evalDate, previousStreak: oldStreak });
        }
      }
    }

    user.lastEvaluatedDate = evalDate;
    evalDate = getNextDateString(evalDate);
  }

  return { evaluatedDays, penalties, shieldsUsed };
}

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

    // Collect all active users dynamically
    const usersToProcess = [];
    if (state.users && typeof state.users === 'object') {
      for (const [key, user] of Object.entries(state.users)) {
        if (!user || typeof user !== 'object') continue;

        // Skip userB if legacy inactive (no username, no id, no streak)
        if (key === 'userB') {
          const isUserBActive = !!(process.env.USER_B_USERNAME || user.username || user.id || (user.streak && user.streak > 0));
          if (!isUserBActive) continue;
        }

        usersToProcess.push({ key, user });
      }
    }

    let stateChanged = false;
    const messagesToSend = [];

    for (const { key, user } of usersToProcess) {
      const now = new Date();
      const currentDateStr = getLocalDateString(now, user.timezone);
      const previousDateStr = getPreviousDateString(currentDateStr);
      const localDayOfWeek = getDayOfWeek(currentDateStr); // 1 = Monday

      // Safety Net: If never evaluated, set it to previousDateStr to avoid retro-penalizing
      if (!user.lastEvaluatedDate) {
        user.lastEvaluatedDate = previousDateStr;
        stateChanged = true;
        // Also check if today is Monday for fresh setup
        if (localDayOfWeek === 1 && user.lastShieldResetDate !== currentDateStr) {
          user.shields = 2;
          user.lastShieldResetDate = currentDateStr;
          messagesToSend.push({
            chatId: announcementChatId,
            text: `✨ <b>¡Comienza una nueva semana!</b> Los escudos de <b>${user.name}</b> se han restablecido a <b>2</b>. 🛡️ ¡Úsalos con sabiduría!\n\n<i>English tip:</i> "A fresh start is a clean slate. Make this week count!" 🚀`
          });
        }
        continue;
      }

      // Sequential multi-day catchup loop: from lastEvaluatedDate + 1 to previousDateStr
      let evalDate = getNextDateString(user.lastEvaluatedDate);

      while (evalDate <= previousDateStr) {
        const evalDayOfWeek = getDayOfWeek(evalDate); // 1 = Monday

        // Monday weekly shield reset for intermediate Monday
        if (evalDayOfWeek === 1 && user.lastShieldResetDate !== evalDate) {
          user.shields = 2;
          user.lastShieldResetDate = evalDate;
          stateChanged = true;
          messagesToSend.push({
            chatId: announcementChatId,
            text: `✨ <b>¡Comienza una nueva semana!</b> Los escudos de <b>${user.name}</b> se han restablecido a <b>2</b>. 🛡️ ¡Úsalos con sabiduría!\n\n<i>English tip:</i> "A fresh start is a clean slate. Make this week count!" 🚀`
          });
        }

        // Check compliance for evalDate
        const completed = (user.checkInHistory && (
                            Array.isArray(user.checkInHistory)
                              ? user.checkInHistory.includes(evalDate)
                              : !!user.checkInHistory[evalDate]
                          )) ||
                          (user.shieldHistory && (
                            Array.isArray(user.shieldHistory)
                              ? user.shieldHistory.includes(evalDate)
                              : !!user.shieldHistory[evalDate]
                          )) ||
                          user.lastCheckIn === evalDate ||
                          user.lastShieldUsedDate === evalDate;

        if (completed) {
          user.lastEvaluatedDate = evalDate;
          stateChanged = true;
          console.log(`[Cron Catchup] User ${user.name} (${key}) verified for ${evalDate}.`);
        } else {
          // Failed to complete practice on evalDate
          if (user.shields > 0) {
            user.shields -= 1;
            user.lastShieldUsedDate = evalDate;
            user.lastEvaluatedDate = evalDate;
            stateChanged = true;

            messagesToSend.push({
              chatId: announcementChatId,
              text: `⚠️ <b>${user.name}</b> no registró su práctica de inglés el día <b>${evalDate}</b>... ¡Pero se ha salvado usando un escudo automático! 🛡️ Le quedan <b>${user.shields} escudos</b> para esta semana.\n\n<i>English reminder:</i> "Don't let the streak break! Try to practice today!" ✍️`
            });
          } else {
            // Out of shields: streak resets to 0 and trigger penalty
            const oldStreak = user.streak;
            user.streak = 0;
            user.lastEvaluatedDate = evalDate;
            stateChanged = true;
            state.forceReset = true; // Crucial for Redis protection safeguard bypass

            if (oldStreak > 0) {
              const randomPenalty = PENALTIES[Math.floor(Math.random() * PENALTIES.length)];

              messagesToSend.push({
                chatId: announcementChatId,
                text: `🚨💥 <b>¡LA CONSTANCIA SE HA ROTO!</b> 💥🚨\n\n` +
                  `<b>${user.name}</b> no completó su práctica de inglés el día <b>${evalDate}</b> y no le quedaban escudos. 😱\n\n` +
                  `Su racha de <b>${oldStreak} días</b> se ha desplomado a <b>0</b>. 😭\n\n` +
                  `⚡ <b>PENALIZACIÓN:</b> Deberá <b>${randomPenalty}</b>\n\n` +
                  `<i>English lesson:</i> "Consistency is hard, but excuses don't build habits. Pay the price and start again!" 💀`
              });
            }
          }
        }

        evalDate = getNextDateString(evalDate);
      }

      // Check for Monday weekly shield reset on currentDateStr (today)
      if (localDayOfWeek === 1 && user.lastShieldResetDate !== currentDateStr) {
        user.shields = 2;
        user.lastShieldResetDate = currentDateStr;
        stateChanged = true;
        messagesToSend.push({
          chatId: announcementChatId,
          text: `✨ <b>¡Comienza una nueva semana!</b> Los escudos de <b>${user.name}</b> se han restablecido a <b>2</b>. 🛡️ ¡Úsalos con sabiduría!\n\n<i>English tip:</i> "A fresh start is a clean slate. Make this week count!" 🚀`
        });
      }

      // Prune historical arrays or objects to conserve Redis memory
      if (user.checkInHistory) {
        if (Array.isArray(user.checkInHistory)) {
          user.checkInHistory = user.checkInHistory.filter(d => d >= user.lastEvaluatedDate);
        } else if (typeof user.checkInHistory === 'object') {
          for (const d of Object.keys(user.checkInHistory)) {
            if (d < user.lastEvaluatedDate) delete user.checkInHistory[d];
          }
        }
      }
      if (user.shieldHistory) {
        if (Array.isArray(user.shieldHistory)) {
          user.shieldHistory = user.shieldHistory.filter(d => d >= user.lastEvaluatedDate);
        } else if (typeof user.shieldHistory === 'object') {
          for (const d of Object.keys(user.shieldHistory)) {
            if (d < user.lastEvaluatedDate) delete user.shieldHistory[d];
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
