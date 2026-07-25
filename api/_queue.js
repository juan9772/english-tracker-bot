import { saveState } from './_db.js';
import { sendTelegramMessage } from './_telegram.js';
import { getLocalDateString } from './_time.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls Gemini API with exponential backoff retries and fallback models.
 */
export async function callGemini(user, text, state, isUserBActive) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;

  const defaultModels = ['gemini-2.5-flash-lite', 'gemini-1.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash'];
  const envModel = (process.env.GEMINI_MODEL || '').trim();
  const modelsToTry = [...new Set([envModel, ...defaultModels].filter(Boolean))];

  const currentDateStr = getLocalDateString(new Date(), user.timezone);
  const isAlreadyDone = user.lastCheckIn === currentDateStr;
  const isAlreadyShielded = user.lastShieldUsedDate === currentDateStr;

  const systemInstructionText = `
Eres "English Tracker Bot". Registras la práctica diaria de inglés.
Analiza el mensaje y responde en JSON:
1. "intent": "start" (bienvenida/ayuda), "shield" (escudo descanso), "status" (consulta racha/estado), "done" (frase inglés), "chat" (conversación casual).
2. "englishPhrase": (solo para "done") Frase limpia en inglés sin prefijos en español.
3. "isEnglishValid": (solo para "done") true si está en inglés, tiene >=10 caracteres y coherencia. Si no, false.
4. "dynamicReply": Respuesta en español breve, informal y motivadora.
   - "start": bienvenida y cómo usar el bot.
   - "shield": confirmación breve según estado del usuario.
   - "done" (válida): felicitación muy corta + tip gramatical/vocabulario breve.
   - "done" (inválida): advertencia graciosa muy corta de por qué no califica.
   - "chat": respuesta corta. Si es charla grupal no dirigida al bot, usa "".
`;

  const promptContent = `
DATOS DEL USUARIO:
- Nombre: ${user.name}
- Racha actual: ${user.streak} días
- Escudos restantes: ${user.shields} / 2
- ¿Ya hizo check-in hoy? ${isAlreadyDone ? 'Sí' : 'No'}
- ¿Ya usó escudo hoy? ${isAlreadyShielded ? 'Sí' : 'No'}
- Fecha local del usuario: ${currentDateStr}

MENSAJE DEL USUARIO:
"${text}"
`;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents: [{ parts: [{ text: promptContent }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              maxOutputTokens: 250,
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  intent: {
                    type: 'STRING',
                    enum: ['start', 'done', 'shield', 'status', 'chat']
                  },
                  englishPhrase: { type: 'STRING' },
                  isEnglishValid: { type: 'BOOLEAN' },
                  dynamicReply: { type: 'STRING' }
                },
                required: ['intent', 'dynamicReply']
              }
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (resultText) {
            return JSON.parse(resultText);
          }
        }

        const status = response.status;
        const errText = await response.text();
        console.warn(`Gemini API error (model ${model}, attempt ${attempt}, status ${status}):`, errText);

        if (status === 404) {
          break; // Switch to next fallback model immediately if endpoint/model 404
        }

        // Retry transient errors (503, 429, 500, 502, 504)
        if ([503, 429, 500, 502, 504].includes(status) && attempt < 3) {
          const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
          await sleep(backoffMs);
          continue;
        }
      } catch (err) {
        console.error(`Fetch error connecting to Gemini API (model ${model}, attempt ${attempt}):`, err);
        if (attempt < 3) {
          await sleep(500 * attempt);
        }
      }
    }
  }

  return null;
}

/**
 * Executes business logic for parsed intents (start, done, shield, status, chat).
 */
export async function executeParsedCommand(user, userKey, command, args, geminiResult, chatId, state) {
  const currentDateStr = getLocalDateString(new Date(), user.timezone);

  if (command === 'chat') {
    if (geminiResult && geminiResult.dynamicReply) {
      await sendTelegramMessage(chatId, geminiResult.dynamicReply);
    }
    return 'Casual chat processed';
  }

  if (command === 'start') {
    await saveState(state);
    const welcome = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
      `¡Hola, <b>${user.name}</b>! 👋 Bienvenidos a nuestro rincón de constancia en inglés. 🇬🇧 Aquí vamos a asegurarnos de que practiques todos los días. ¡A no aflojar!\n\n` +
      `Tus comandos disponibles son:\n` +
      `👉 <b><code>/done [frase en inglés]</code></b> - Hace tu check-in del día (mínimo 10 caracteres).\n` +
      `👉 <b><code>/shield</code></b> - Gasta un escudo semanal (máximo 2 por semana) si hoy no puedes estudiar.\n` +
      `👉 <b><code>/status</code></b> - Mira el estado de tu racha y escudos.\n\n` +
      `<i>Remember:</i> "Consistency is the key to mastering any language! Let's do this!" 🚀`;

    await sendTelegramMessage(chatId, welcome);
    return 'Start command processed';
  }

  if (command === 'done') {
    const isEnglishValid = geminiResult ? geminiResult.isEnglishValid : (args && args.length >= 10);

    if (!isEnglishValid) {
      const exampleText = geminiResult && geminiResult.dynamicReply ?
        `¡Epa, <b>${user.name}</b>! 🚨\n\n` +
        `<i>${geminiResult.dynamicReply}</i>` :
        `¡Epa, <b>${user.name}</b>! 🚨 La frase de hoy debe tener al menos 10 caracteres para contar como práctica real. ¡No me hagas trampa! 😉\n\n` +
        `Intenta escribir algo que hayas aprendido, leído o escuchado hoy. Por ejemplo:\n` +
        `👉 <code>/done Today I learned the difference between "make" and "do".</code>\n` +
        `👉 <code>/done I read a short article in English and practiced my listening.</code>\n\n` +
        `<i>Try again!</i> "You can do better, I believe in you! 💪"`;
      
      await sendTelegramMessage(chatId, exampleText);
      return 'Done phrase too short or invalid';
    }

    if (user.lastCheckIn === currentDateStr) {
      const doubleCheckInMsg = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
        `¡Che, <b>${user.name}</b>! Ya registré tu práctica de hoy. ¡No hace falta que lo hagas de nuevo! 🌟\n\n` +
        `<i>Well done!</i> "Keep shining and enjoy your rest! ✨"`;
      
      await sendTelegramMessage(chatId, doubleCheckInMsg);
      return 'Done already registered';
    }

    const hadUsedShieldToday = user.lastShieldUsedDate === currentDateStr;
    let shieldRefundText = '';
    if (hadUsedShieldToday) {
      user.shields += 1;
      user.lastShieldUsedDate = null;
      shieldRefundText = `🛡️ ¡Además, como hiciste la tarea, te devolví el escudo que habías activado hoy! Te quedan <b>${user.shields} escudos</b>.\n`;
    }

    user.lastCheckIn = currentDateStr;
    user.streak += 1;
    await saveState(state);

    const successMsg = geminiResult && geminiResult.dynamicReply ?
      `¡Espectacular, <b>${user.name}</b>! 🎉 He registrado tu frase de hoy:\n` +
      `<i>"${args}"</i>\n\n` +
      `<i>${geminiResult.dynamicReply}</i>\n\n` +
      `${shieldRefundText}` +
      `Tu racha actual ahora es de 🔥 <b>${user.streak} días</b>.` :
      `¡Espectacular, <b>${user.name}</b>! 🎉 He registrado tu frase de hoy:\n` +
      `<i>"${args}"</i>\n\n` +
      `${shieldRefundText}` +
      `Tu racha actual ahora es de 🔥 <b>${user.streak} días</b>.\n\n` +
      `<i>Awesome job!</i> "Every small step takes you closer to fluency! Keep it up! 🚀"`;

    await sendTelegramMessage(chatId, successMsg);
    return 'Done registered';
  }

  if (command === 'shield') {
    if (user.lastCheckIn === currentDateStr) {
      const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
        `¡Che, <b>${user.name}</b>! Hoy ya hiciste tu check-in de inglés, así que no necesitas gastar un escudo. ¡Guárdalo para cuando de verdad te haga falta! 😉\n\n` +
        `<i>Good decision!</i> "Use your shields wisely! 🛡️"`;
      
      await sendTelegramMessage(chatId, reply);
      return 'Shield ignored - already done';
    }

    if (user.lastShieldUsedDate === currentDateStr) {
      const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
        `¡Ojo! Hoy ya activaste tu escudo protector, <b>${user.name}</b>. ¡Estás a salvo por hoy! 🛡️ Descansa tranquilo.\n\n` +
        `<i>Take it easy!</i> "Enjoy your day off! 🍕"`;
      
      await sendTelegramMessage(chatId, reply);
      return 'Shield ignored - already used';
    }

    if (user.shields > 0) {
      user.shields -= 1;
      user.lastShieldUsedDate = currentDateStr;
      await saveState(state);

      const reply = geminiResult && geminiResult.dynamicReply ?
        `🛡️ ¡Escudo activado para hoy, <b>${user.name}</b>!\n\n` +
        `<i>${geminiResult.dynamicReply}</i>\n\n` +
        `Te quedan <b>${user.shields} escudos</b> para esta semana.` :
        `🛡️ ¡Escudo activado para hoy, <b>${user.name}</b>! Quedas libre del inglés por este día sin perder tu racha de 🔥 <b>${user.streak} días</b>. Te quedan <b>${user.shields} escudos</b> para esta semana.\n\n` +
        `<i>Enjoy your break!</i> "Rest is part of the work. See you tomorrow! 💤"`;
      
      await sendTelegramMessage(chatId, reply);
      return 'Shield activated';
    } else {
      const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
        `¡Uf, qué mala suerte, <b>${user.name}</b>! 😰 Ya no te quedan escudos disponibles para esta semana (recuerda que se resetean los lunes). ¡Vas a tener que meterle pata y hacer <code>/done</code> para no perder la racha!\n\n` +
        `<i>Don't give up!</i> "No pain, no gain! You've got this! 💥"`;
      
      await sendTelegramMessage(chatId, reply);
      return 'Shield failed - no shields left';
    }
  }

  if (command === 'status') {
    const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB.username || state.users.userB.id);

    const currentDateStrA = getLocalDateString(new Date(), state.users.userA.timezone);
    const checkInA = state.users.userA.lastCheckIn === currentDateStrA;
    const shieldA = state.users.userA.lastShieldUsedDate === currentDateStrA;
    
    let statusA = 'Pendiente ⏳';
    if (checkInA) statusA = '¡Completado! 🎯';
    else if (shieldA) statusA = 'Usó Escudo 🛡️';

    let statusB = '';
    let streakB = '';
    let shieldsB = '';

    if (isUserBActive) {
      const currentDateStrB = getLocalDateString(new Date(), state.users.userB.timezone);
      const checkInB = state.users.userB.lastCheckIn === currentDateStrB;
      const shieldB = state.users.userB.lastShieldUsedDate === currentDateStrB;
      
      statusB = 'Pendiente ⏳';
      if (checkInB) statusB = '¡Completado! 🎯';
      else if (shieldB) statusB = 'Usó Escudo 🛡️';
      
      streakB = `🔥 <b>Racha:</b> ${state.users.userB.streak} días`;
      shieldsB = `🛡️ <b>Escudos:</b> ${state.users.userB.shields} / 2`;
    } else {
      statusB = 'Esperando conexión... ⏳';
      streakB = '🔥 <b>Racha:</b> -';
      shieldsB = '🛡️ <b>Escudos:</b> -';
    }

    const reportHeader = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply + '\n\n' : '';

    const report = reportHeader +
      `📊 <b>ESTADO DE CONSTANCIA EN INGLÉS</b> 🇬🇧\n\n` +
      `👤 <b>${state.users.userA.name}</b>\n` +
      `🔥 <b>Racha:</b> ${state.users.userA.streak} días\n` +
      `🛡️ <b>Escudos:</b> ${state.users.userA.shields} / 2\n` +
      `⚡ <b>Hoy:</b> ${statusA}\n\n` +
      `👤 <b>${state.users.userB.name}</b>\n` +
      `${streakB}\n` +
      `${shieldsB}\n` +
      `⚡ <b>Hoy:</b> ${statusB}\n\n` +
      `<i>Quote of the day:</i> "Success is the sum of small efforts, repeated day in and day out." 💪`;

    await sendTelegramMessage(chatId, report);
    return 'Status command processed';
  }

  return 'Unknown command';
}

/**
 * Processes pending messages in state.queue
 */
export async function processQueue(state) {
  if (!state.queue || state.queue.length === 0) return;

  const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB.username || state.users.userB.id);
  const initialCount = state.queue.length;
  const remainingQueue = [];
  let stateChanged = false;

  for (const item of state.queue) {
    const user = state.users[item.userKey];
    if (!user) continue;

    let geminiResult = null;
    if (process.env.GEMINI_API_KEY) {
      geminiResult = await callGemini(user, item.text, state, isUserBActive);
    }

    if (geminiResult) {
      const command = geminiResult.intent;
      const args = geminiResult.englishPhrase || '';
      await executeParsedCommand(user, item.userKey, command, args, geminiResult, item.chatId, state);
      stateChanged = true;
    } else {
      // Check heuristic slash command fallback
      let command = '';
      let args = '';
      if (item.text.startsWith('/')) {
        const firstSpace = item.text.indexOf(' ');
        const cmdPart = firstSpace === -1 ? item.text : item.text.substring(0, firstSpace);
        args = firstSpace === -1 ? '' : item.text.substring(firstSpace + 1).trim();
        command = cmdPart.replace(/^\/(\w+)(@\w+)?$/i, '$1').toLowerCase();
      }

      const ALLOWED_COMMANDS = ['start', 'done', 'shield', 'status'];
      if (command && ALLOWED_COMMANDS.includes(command)) {
        await executeParsedCommand(user, item.userKey, command, args, null, item.chatId, state);
        stateChanged = true;
      } else {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts >= 3) {
          // Fallback after max attempts
          if (item.text.length >= 10) {
            await executeParsedCommand(user, item.userKey, 'done', item.text, null, item.chatId, state);
          } else {
            await sendTelegramMessage(item.chatId, `⚠️ No pudimos procesar tu mensaje con la IA después de varios reintentos. Si querías registrar tu práctica, asegúrate de escribir una frase en inglés de al menos 10 caracteres o usar <code>/done [frase]</code>.`);
          }
          stateChanged = true;
        } else {
          remainingQueue.push(item);
        }
      }
    }
  }

  state.queue = remainingQueue;
  if (stateChanged || remainingQueue.length !== initialCount) {
    await saveState(state);
  }
}
