import { getState, saveState, findUserKey } from './_db.js';
import { sendTelegramMessage, formatTelegramHtml, createInlineKeyboard } from './_telegram.js';
import { getLocalDateString } from './_time.js';
import { callGemini } from './_gemini.js';
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

/**
 * Acknowledges Telegram callback query promptly to dismiss client UI spinner.
 */
export async function answerCallbackQuery(callbackQueryId, text = '¡Acción recibida! ⚡', showAlert = false) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !callbackQueryId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert
      })
    });
    return res.ok;
  } catch (err) {
    console.error('Error in answerCallbackQuery:', err);
    return false;
  }
}

/**
 * Downloads voice audio stream (.oga/.ogg) from Telegram API and returns Base64.
 */
export async function downloadVoiceFile(fileId) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not defined');

  const getFileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId })
  });

  const getFileData = await getFileRes.json();
  if (!getFileData.ok || !getFileData.result?.file_path) {
    throw new Error('Telegram getFile failed: ' + JSON.stringify(getFileData));
  }

  const filePath = getFileData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`Failed to download audio file from ${downloadUrl}: ${fileRes.statusText}`);
  }

  let audioBuffer;
  if (typeof fileRes.buffer === 'function') {
    audioBuffer = await fileRes.buffer();
  } else {
    const arrayBuf = await fileRes.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuf);
  }

  return audioBuffer.toString('base64');
}

const SPARK_POOL = [
  "What is one English habit or routine you are proud of maintaining?",
  "If you could travel anywhere tomorrow to practice English, where would you go and why?",
  "Describe a challenging situation you encountered recently and how you solved it.",
  "What is a book, movie, or song that taught you a memorable English phrase?",
  "Do you think AI tools can replace human conversation practice? Why or why not?",
  "Tell a short 3-sentence story about a funny misunderstanding you once experienced.",
  "What does 'consistency' mean to you when building a lifelong habit?"
];

export function getSparkForDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return SPARK_POOL[0];
  const hash = dateStr.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return SPARK_POOL[hash % SPARK_POOL.length];
}

/**
 * M2: Daily Spark handler.
 */
export async function handleSparkCommand(chatId, state) {
  const todayStr = getLocalDateString(new Date(), 'America/Argentina/Buenos_Aires');
  let sparkQuestion = '';

  if (state.dailySpark) {
    if (typeof state.dailySpark === 'object' && state.dailySpark.question) {
      sparkQuestion = state.dailySpark.question;
    } else if (typeof state.dailySpark === 'string') {
      sparkQuestion = state.dailySpark;
    }
  }

  if (!sparkQuestion) {
    sparkQuestion = getSparkForDate(todayStr);
  }

  const formattedSpark = formatTelegramHtml(sparkQuestion);

  const reply = `💡 <b>Reto Temático del Día (Daily Spark)</b> 🇬🇧\n\n` +
    `<blockquote>"${formattedSpark}"</blockquote>\n\n` +
    `👉 <i>Cómo participar:</i> Envía un mensaje de voz 🎙️ o escribe tu respuesta usando <code>/done [tu frase en inglés]</code>.\n` +
    `<i>Tip:</i> ¡Intenta usar conectores como <code>"However"</code>, <code>"In my opinion"</code> o <code>"As far as I know"</code>! 🚀`;

  await sendTelegramMessage(chatId, reply, { reply_markup: createInlineKeyboard() });
  return 'Daily spark sent';
}

/**
 * M4: Spaced repetition vocabulary review handler.
 */
export async function handleReviewCommand(chatId, user, state) {
  const vocab = user.vocabulary || [];
  if (vocab.length === 0) {
    const emptyReply = `📚 <b>Banco de Vocabulario</b>\n\n` +
      `Tu banco de vocabulario está vacío por ahora. ¡Haz tu check-in diario con <code>/done</code> o una nota de voz para extraer y guardar automáticamente tu primera frase clave! 🌟\n\n` +
      `<i>English tip:</i> "The journey of a thousand miles begins with a single word." 📖`;
    await sendTelegramMessage(chatId, emptyReply, { reply_markup: createInlineKeyboard() });
    return 'Review bank empty';
  }

  // Sort by reviewCount ascending to practice less reviewed items first
  const sorted = [...vocab].sort((a, b) => (a.reviewCount || 0) - (b.reviewCount || 0));
  const card = sorted[0];
  card.reviewCount = (card.reviewCount || 0) + 1;
  await saveState(state);

  const cardReply = `📚 <b>Repaso de Vocabulario (Spaced Repetition)</b> 🧠\n\n` +
    `🔤 <b>Término / Modismo:</b> <code>${formatTelegramHtml(card.term)}</code>\n` +
    `📖 <b>Significado:</b> <i>${formatTelegramHtml(card.meaning)}</i>\n` +
    `📝 <b>Ejemplo:</b> <blockquote>${formatTelegramHtml(card.example)}</blockquote>\n\n` +
    `🔄 <i>Repasos completados: ${card.reviewCount} | Total en tu banco: ${vocab.length} / 30</i>\n\n` +
    `💡 <i>Desafío:</i> ¡Intenta crear una oración propia usando este término hoy en tu práctica con <code>/done</code> o nota de voz! ✍️`;

  await sendTelegramMessage(chatId, cardReply, { reply_markup: createInlineKeyboard() });
  return 'Review flashcard sent';
}

/**
 * M3: Evening streak warning alert handler.
 */
export async function handleStreakAlertCommand(chatId, state) {
  const users = Object.values(state.users || {}).filter(u => u && typeof u === 'object');
  const pendingUsers = [];

  for (const u of users) {
    const userDate = getLocalDateString(new Date(), u.timezone || 'America/Argentina/Buenos_Aires');
    const isDone = u.lastCheckIn === userDate;
    const isShielded = u.lastShieldUsedDate === userDate;
    if (!isDone && !isShielded) {
      pendingUsers.push(u);
    }
  }

  if (pendingUsers.length === 0) {
    const msg = `🎉 <b>¡Felicitaciones!</b> Todos los participantes completaron su práctica o usaron escudo hoy. ¡La constancia sigue intacta! 🚀`;
    await sendTelegramMessage(chatId, msg, { reply_markup: createInlineKeyboard() });
    return 'All participants checked in';
  }

  let alertMsg = `⚠️ <b>¡Alerta Preventiva de Racha!</b> ⏰\n\n` +
    `Los siguientes participantes aún tienen pendiente su práctica de hoy:\n\n`;

  for (const u of pendingUsers) {
    const mention = u.username ? `@${u.username}` : `<b>${u.name}</b>`;
    alertMsg += `• ${mention}: Racha en juego: 🔥 <b>${u.streak} días</b> | Escudos disponibles: <b>${u.shields}</b>\n`;
  }

  alertMsg += `\nRecuerden que tienen hasta la medianoche para enviar su nota de voz 🎙️ o frase con <code>/done</code>, o usar un <code>/shield</code> si tuvieron un día complicado. ¡A no aflojar! 💪`;

  await sendTelegramMessage(chatId, alertMsg, { reply_markup: createInlineKeyboard() });
  return 'Streak alert sent';
}

/**
 * /status command handler.
 */
export async function handleStatusCommand(chatId, state, requestingUser, geminiResult = null) {
  let report = '';
  if (geminiResult && geminiResult.dynamicReply) {
    report += formatTelegramHtml(geminiResult.dynamicReply) + '\n\n';
  }

  report += `📊 <b>ESTADO DE CONSTANCIA EN INGLÉS</b> 🇬🇧\n\n`;

  const usersList = Object.entries(state.users || {}).filter(([_, u]) => u && typeof u === 'object');
  const sortedUsers = usersList.sort(([keyA], [keyB]) => {
    if (keyA === 'userA') return -1;
    if (keyB === 'userA') return 1;
    if (keyA === 'userB') return -1;
    if (keyB === 'userB') return 1;
    return keyA.localeCompare(keyB);
  });

  for (const [key, user] of sortedUsers) {
    if (key === 'userB' && !process.env.USER_B_USERNAME && !user.username && !user.id) {
      report += `👤 <b>${user.name}</b>\n` +
        `🔥 <b>Racha:</b> -\n` +
        `🛡️ <b>Escudos:</b> -\n` +
        `⚡ <b>Hoy:</b> Esperando conexión... ⏳\n\n`;
      continue;
    }

    const userDate = getLocalDateString(new Date(), user.timezone || 'America/Argentina/Buenos_Aires');
    const checkedIn = user.lastCheckIn === userDate;
    const shielded = user.lastShieldUsedDate === userDate;

    let todayStatus = 'Pendiente ⏳';
    if (checkedIn) todayStatus = '¡Completado! 🎯';
    else if (shielded) todayStatus = 'Usó Escudo 🛡️';

    const cefrText = user.profile?.cefrLevel ? ` (Nivel: <b>${user.profile.cefrLevel}</b>)` : '';

    report += `👤 <b>${user.name}</b>${cefrText}\n` +
      `🔥 <b>Racha:</b> ${user.streak} días\n` +
      `🛡️ <b>Escudos:</b> ${user.shields} / 2\n` +
      `⚡ <b>Hoy:</b> ${todayStatus}\n\n`;
  }

  const todaySpark = typeof state.dailySpark === 'object' && state.dailySpark?.question
    ? state.dailySpark.question
    : (typeof state.dailySpark === 'string' && state.dailySpark ? state.dailySpark : null);

  if (todaySpark) {
    report += `💡 <b>Reto del Día:</b>\n"${formatTelegramHtml(todaySpark)}"\n\n`;
  }

  report += `<i>Quote of the day:</i> "Success is the sum of small efforts, repeated day in and day out." 💪`;

  await sendTelegramMessage(chatId, report, { reply_markup: createInlineKeyboard() });
  return 'Status command processed';
}

/**
 * /shield command handler.
 */
export async function handleShieldCommand(chatId, user, state, geminiResult = null) {
  const currentDateStr = getLocalDateString(new Date(), user.timezone || 'America/Argentina/Buenos_Aires');

  if (user.lastCheckIn === currentDateStr) {
    const reply = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) :
      `¡Che, <b>${user.name}</b>! Hoy ya hiciste tu check-in de inglés, así que no necesitas gastar un escudo. ¡Guárdalo para cuando de verdad te haga falta! 😉\n\n` +
      `<i>Good decision!</i> "Use your shields wisely! 🛡️"`;
    
    await sendTelegramMessage(chatId, reply, { reply_markup: createInlineKeyboard() });
    return 'Shield ignored - already done';
  }

  if (user.lastShieldUsedDate === currentDateStr) {
    const reply = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) :
      `¡Ojo! Hoy ya activaste tu escudo protector, <b>${user.name}</b>. ¡Estás a salvo por hoy! 🛡️ Descansa tranquilo.\n\n` +
      `<i>Take it easy!</i> "Enjoy your day off! 🍕"`;
    
    await sendTelegramMessage(chatId, reply, { reply_markup: createInlineKeyboard() });
    return 'Shield ignored - already used';
  }

  if (user.shields > 0) {
    user.shields -= 1;
    user.lastShieldUsedDate = currentDateStr;
    if (!user.shieldHistory) user.shieldHistory = {};
    user.shieldHistory[currentDateStr] = true;
    await saveState(state);

    const formattedShieldReply = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) : '';
    const reply = geminiResult && geminiResult.dynamicReply ?
      `🛡️ ¡Escudo activado para hoy, <b>${user.name}</b>!\n\n` +
      `${formattedShieldReply}\n\n` +
      `Te quedan <b>${user.shields} escudos</b> para esta semana.` :
      `🛡️ ¡Escudo activado para hoy, <b>${user.name}</b>! Quedas libre del inglés por este día sin perder tu racha de 🔥 <b>${user.streak} días</b>. Te quedan <b>${user.shields} escudos</b> para esta semana.\n\n` +
      `<i>Enjoy your break!</i> "Rest is part of the work. See you tomorrow! 💤"`;
    
    await sendTelegramMessage(chatId, reply, { reply_markup: createInlineKeyboard() });
    return 'Shield activated';
  } else {
    const reply = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) :
      `¡Uf, qué mala suerte, <b>${user.name}</b>! 😰 Ya no te quedan escudos disponibles para esta semana (recuerda que se resetean los lunes). ¡Vas a tener que meterle pata y hacer <code>/done</code> para no perder la racha!\n\n` +
      `<i>Don't give up!</i> "No pain, no gain! You've got this! 💥"`;
    
    await sendTelegramMessage(chatId, reply, { reply_markup: createInlineKeyboard() });
    return 'Shield failed - no shields left';
  }
}

/**
 * /start command handler.
 */
export async function handleStartCommand(chatId, user, state, geminiResult = null) {
  await saveState(state);
  const welcome = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) :
    `¡Hola, <b>${user.name}</b>! 👋 Bienvenidos a nuestro rincón de constancia en inglés. 🇬🇧 Aquí vamos a asegurarnos de que practiques todos los días. ¡A no aflojar!\n\n` +
    `Tus comandos disponibles son:\n` +
    `👉 <b><code>/done [frase en inglés]</code></b> - Hace tu check-in del día (mínimo 10 caracteres).\n` +
    `👉 <b>Nota de voz 🎙️</b> - Graba un audio en inglés para evaluar pronunciación y fluidez oral.\n` +
    `👉 <b><code>/shield</code></b> - Gasta un escudo semanal (máximo 2 por semana) si hoy no puedes estudiar.\n` +
    `👉 <b><code>/status</code></b> - Mira el estado de tu racha y escudos.\n` +
    `👉 <b><code>/spark</code></b> - Reto temático de conversación del día.\n` +
    `👉 <b><code>/review</code></b> - Repaso espaciado de vocabulario y modismos.\n\n` +
    `<i>Remember:</i> "Consistency is the key to mastering any language! Let's do this!" 🚀`;

  await sendTelegramMessage(chatId, welcome, { reply_markup: createInlineKeyboard() });
  return 'Start command processed';
}

/**
 * /done command handler.
 */
export async function handleDoneCommand(chatId, user, userKey, phrase, geminiResult, state) {
  const currentDateStr = getLocalDateString(new Date(), user.timezone || 'America/Argentina/Buenos_Aires');
  const isEnglishValid = geminiResult
    ? (geminiResult.valid ?? geminiResult.isEnglishValid)
    : (phrase && phrase.length >= 10);

  if (!isEnglishValid) {
    const exampleText = geminiResult && geminiResult.dynamicReply ?
      `¡Epa, <b>${user.name}</b>! 🚨\n\n` +
      `${formatTelegramHtml(geminiResult.dynamicReply)}` :
      `¡Epa, <b>${user.name}</b>! 🚨 La frase de hoy debe tener al menos 10 caracteres para contar como práctica real. ¡No me hagas trampa! 😉\n\n` +
      `Intenta escribir algo que hayas aprendido, leído o escuchado hoy. Por ejemplo:\n` +
      `👉 <code>/done Today I learned the difference between "make" and "do".</code>\n` +
      `👉 <code>/done I read a short article in English and practiced my listening.</code>\n\n` +
      `<i>Try again!</i> "You can do better, I believe in you! 💪"`;
    
    await sendTelegramMessage(chatId, exampleText, { reply_markup: createInlineKeyboard() });
    return 'Done phrase too short or invalid';
  }

  if (user.lastCheckIn === currentDateStr) {
    const doubleCheckInMsg = geminiResult && geminiResult.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) :
      `¡Che, <b>${user.name}</b>! Ya registré tu práctica de hoy. ¡No hace falta que lo hagas de nuevo! 🌟\n\n` +
      `<i>Well done!</i> "Keep shining and enjoy your rest! ✨"`;
    
    await sendTelegramMessage(chatId, doubleCheckInMsg, { reply_markup: createInlineKeyboard() });
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
  if (!user.checkInHistory) user.checkInHistory = {};
  user.checkInHistory[currentDateStr] = true;

  // Update R4 Learning Profile in Redis (< 500 bytes)
  if (geminiResult?.learningProfileUpdate) {
    user.profile = {
      cefrLevel: geminiResult.learningProfileUpdate.cefrLevel || user.profile?.cefrLevel || 'B1',
      strengths: (geminiResult.learningProfileUpdate.strengths || []).slice(0, 3),
      focusAreas: (geminiResult.learningProfileUpdate.focusAreas || []).slice(0, 3),
      lastUpdated: new Date().toISOString()
    };
  }

  // Update M4 Vocabulary Bank in Redis (bounded to 30 items)
  if (geminiResult?.vocabularyItem && geminiResult.vocabularyItem.term) {
    user.vocabulary = user.vocabulary || [];
    const termLower = geminiResult.vocabularyItem.term.toLowerCase().trim();
    const existingIdx = user.vocabulary.findIndex(v => v.term.toLowerCase().trim() === termLower);
    if (existingIdx >= 0) {
      user.vocabulary[existingIdx].reviewCount = (user.vocabulary[existingIdx].reviewCount || 0) + 1;
    } else {
      user.vocabulary.push({
        term: geminiResult.vocabularyItem.term,
        meaning: geminiResult.vocabularyItem.meaning || '',
        example: geminiResult.vocabularyItem.example || '',
        addedDate: currentDateStr,
        reviewCount: 0
      });
    }
    if (user.vocabulary.length > 30) {
      user.vocabulary = user.vocabulary.slice(-30);
    }
  }

  await saveState(state);

  let vocabText = '';
  if (geminiResult?.vocabularyItem?.term) {
    vocabText = `\n\n📚 <b>Modismo / Colocación extraída:</b>\n` +
      `🔤 <code>${formatTelegramHtml(geminiResult.vocabularyItem.term)}</code> - <i>${formatTelegramHtml(geminiResult.vocabularyItem.meaning)}</i>\n` +
      `<i>"${formatTelegramHtml(geminiResult.vocabularyItem.example)}"</i>`;
  }

  const formattedReply = geminiResult?.dynamicReply ? formatTelegramHtml(geminiResult.dynamicReply) : '';

  const successMsg = geminiResult && geminiResult.dynamicReply ?
    `¡Espectacular, <b>${user.name}</b>! 🎉 He registrado tu práctica de hoy:\n\n` +
    `${formattedReply}` +
    `${vocabText}\n\n` +
    `${shieldRefundText}` +
    `Tu racha actual ahora es de 🔥 <b>${user.streak} días</b>.` :
    `¡Espectacular, <b>${user.name}</b>! 🎉 He registrado tu frase de hoy:\n` +
    `<i>"${phrase}"</i>\n\n` +
    `${shieldRefundText}` +
    `Tu racha actual ahora es de 🔥 <b>${user.streak} días</b>.\n\n` +
    `<i>Awesome job!</i> "Every small step takes you closer to fluency! Keep it up! 🚀"`;

  await sendTelegramMessage(chatId, successMsg, { reply_markup: createInlineKeyboard() });
  return 'Done registered';
}

/**
 * Main Telegram Webhook handler for Vercel Serverless.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'Method Not Allowed' });
  }

  let update = req.body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update);
    } catch (e) {
      update = {};
    }
  }
  update = update || {};

  console.log('Received Telegram Update:', JSON.stringify(update));

  try {
    const state = await getState();

    // Process any previously queued messages first
    if (state.queue && state.queue.length > 0) {
      await processQueue(state);
    }

    // =========================================================================
    // Case 1: Inline Keyboard Button Click (callback_query)
    // =========================================================================
    if (update.callback_query) {
      const cb = update.callback_query;
      // Immediately answer callback query to dismiss client spinner
      await answerCallbackQuery(cb.id, '¡Acción recibida! ⚡');

      const userKey = findUserKey(state, cb);
      const chatId = cb.message?.chat?.id || state.chatId || cb.from?.id;

      if (!userKey || !state.users[userKey]) {
        await answerCallbackQuery(cb.id, 'No estás registrado en este grupo de estudio.', true);
        if (chatId) {
          const replyMsg = `Hum... ¡Hola! 🧐 No reconozco tu usuario de Telegram en este grupo de estudio.\n` +
            `<i>English note:</i> "Only registered members can join the challenge!" ⚙️`;
          await sendTelegramMessage(chatId, replyMsg, { reply_markup: createInlineKeyboard() });
        }
        return respond(res, 200, 'Unregistered callback query');
      }

      const user = state.users[userKey];
      const data = cb.data || '';

      if (data === 'cmd:status') {
        const resultMsg = await handleStatusCommand(chatId, state, user);
        return respond(res, 200, resultMsg);
      }

      if (data === 'cmd:shield') {
        const resultMsg = await handleShieldCommand(chatId, user, state);
        return respond(res, 200, resultMsg);
      }

      if (data === 'cmd:spark') {
        const resultMsg = await handleSparkCommand(chatId, state);
        return respond(res, 200, resultMsg);
      }

      if (data === 'cmd:review') {
        const resultMsg = await handleReviewCommand(chatId, user, state);
        return respond(res, 200, resultMsg);
      }

      return respond(res, 200, `Unhandled callback_data: ${data}`);
    }

    // =========================================================================
    // Case 2: Voice Note or Audio Message (M1 Speaking Practice)
    // =========================================================================
    const msg = update.message;
    if (!msg) {
      return respond(res, 200, 'No processable event found in update');
    }

    if (msg.voice || msg.audio) {
      const voice = msg.voice || msg.audio;
      const fileId = voice.file_id;

      const userKey = findUserKey(state, msg);
      if (!userKey) {
        const replyMsg = `Hum... ¡Hola <b>${msg.from.first_name}</b>! 🧐 No reconozco tu usuario de Telegram (<code>@${msg.from.username || 'sin_usuario'}</code>) en este grupo de estudio.\n\n` +
          `<i>English note:</i> "Only registered members can join the challenge! Let's get configured first!" ⚙️`;
        await sendTelegramMessage(msg.chat.id, replyMsg);
        return respond(res, 200, 'Unregistered user');
      }

      const user = state.users[userKey];

      // Update user details if changed
      let detailsChanged = false;
      if (user.id !== msg.from.id.toString()) {
        user.id = msg.from.id.toString();
        detailsChanged = true;
      }
      if (msg.from.username && user.username !== msg.from.username) {
        user.username = msg.from.username;
        detailsChanged = true;
      }
      if (user.name === 'Usuario A' || user.name === 'Usuario B' || !user.name) {
        user.name = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '');
        detailsChanged = true;
      }
      if (msg.chat?.id && state.chatId !== msg.chat.id) {
        state.chatId = msg.chat.id;
        detailsChanged = true;
      }
      if (detailsChanged) {
        await saveState(state);
      }

      if (voice.duration === 0 || voice.file_size === 0) {
        await sendTelegramMessage(msg.chat.id, `¡Epa, <b>${user.name}</b>! 🚨 El audio parece estar vacío o durar 0 segundos. Por favor, graba una nota de voz clara con tu práctica en inglés.`, { reply_markup: createInlineKeyboard() });
        return respond(res, 200, 'Empty audio');
      }

      // Download audio stream and encode to Base64
      let audioBase64 = '';
      try {
        audioBase64 = await downloadVoiceFile(fileId);
      } catch (dlErr) {
        console.error('Error downloading voice file:', dlErr);
        await sendTelegramMessage(msg.chat.id, `⚠️ Hubo un inconveniente al descargar tu nota de voz desde Telegram. Por favor, intenta enviarla nuevamente.`, { reply_markup: createInlineKeyboard() });
        return respond(res, 200, 'Voice download error');
      }

      // Call Gemini Multimodal with audioBase64
      let geminiResult = null;
      if (process.env.GEMINI_API_KEY) {
        geminiResult = await callGemini(
          'Evaluate English practice voice note and return structured pedagogical JSON.',
          {
            audioBase64,
            mimeType: voice.mime_type || 'audio/ogg',
            user,
            state
          }
        );
      }

      if (!geminiResult) {
        // Enqueue voice message if Gemini unavailable
        state.queue = state.queue || [];
        state.queue.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          chatId: msg.chat.id,
          userKey: userKey,
          text: '[Voice Note]',
          audioBase64: audioBase64,
          timestamp: Date.now(),
          attempts: 0
        });
        await saveState(state);

        const queueNotice = `📥 <b>¡Audio recibido!</b> En este momento los servidores de IA de Google están experimentando alta demanda. Guardé tu nota de voz en la cola de espera y te responderé de forma automática en cuanto se restablezca el servicio. ¡No perderás tu racha! ⏳`;
        await sendTelegramMessage(msg.chat.id, queueNotice, { reply_markup: createInlineKeyboard() });
        return respond(res, 200, 'Voice note queued');
      }

      const isEnglishValid = geminiResult.valid ?? geminiResult.isEnglishValid;
      if (!isEnglishValid) {
        const warningMsg = `¡Epa, <b>${user.name}</b>! 🚨 No pude validar tu audio como práctica de inglés suficiente.\n\n` +
          (geminiResult.feedbackHtml ? `${formatTelegramHtml(geminiResult.feedbackHtml)}\n\n` : '') +
          (geminiResult.pronunciationFeedback ? `🗣️ <b>Pronunciación:</b> ${geminiResult.pronunciationFeedback}\n\n` : '') +
          `👉 Intenta grabar una nota de voz en inglés de al menos 5 a 10 segundos pronunciando oraciones completas.\n\n` +
          `<i>Try again!</i> "Every attempt makes you better! Let's hear your English! 🎙️💪"`;
        await sendTelegramMessage(msg.chat.id, warningMsg, { reply_markup: createInlineKeyboard() });
        return respond(res, 200, 'Voice note invalid');
      }

      const currentDateStr = getLocalDateString(new Date(), user.timezone || 'America/Argentina/Buenos_Aires');
      if (user.lastCheckIn === currentDateStr) {
        const doubleCheckInMsg = `¡Che, <b>${user.name}</b>! Ya registré tu práctica de hoy. ¡No hace falta que lo hagas de nuevo! 🌟\n\n` +
          `🎙️ <b>Transcripción de tu nuevo audio:</b>\n<blockquote>${geminiResult.transcription || geminiResult.englishPhrase}</blockquote>\n\n` +
          (geminiResult.pronunciationFeedback ? `🗣️ <b>Pronunciación:</b> ${geminiResult.pronunciationFeedback}\n\n` : '') +
          formatTelegramHtml(geminiResult.feedbackHtml);
        await sendTelegramMessage(msg.chat.id, doubleCheckInMsg, { reply_markup: createInlineKeyboard() });
        return respond(res, 200, 'Voice note already registered');
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
      if (!user.checkInHistory) user.checkInHistory = {};
      user.checkInHistory[currentDateStr] = true;

      // Update R4 Learning Profile in Redis (< 500 bytes)
      if (geminiResult.learningProfileUpdate) {
        user.profile = {
          cefrLevel: geminiResult.learningProfileUpdate.cefrLevel || user.profile?.cefrLevel || 'B1',
          strengths: (geminiResult.learningProfileUpdate.strengths || []).slice(0, 3),
          focusAreas: (geminiResult.learningProfileUpdate.focusAreas || []).slice(0, 3),
          lastUpdated: new Date().toISOString()
        };
      }

      // Update M4 Vocabulary Bank in Redis (bounded to 30 items)
      if (geminiResult.vocabularyItem && geminiResult.vocabularyItem.term) {
        user.vocabulary = user.vocabulary || [];
        const termLower = geminiResult.vocabularyItem.term.toLowerCase().trim();
        const existingIdx = user.vocabulary.findIndex(v => v.term.toLowerCase().trim() === termLower);
        if (existingIdx >= 0) {
          user.vocabulary[existingIdx].reviewCount = (user.vocabulary[existingIdx].reviewCount || 0) + 1;
        } else {
          user.vocabulary.push({
            term: geminiResult.vocabularyItem.term,
            meaning: geminiResult.vocabularyItem.meaning || '',
            example: geminiResult.vocabularyItem.example || '',
            addedDate: currentDateStr,
            reviewCount: 0
          });
        }
        if (user.vocabulary.length > 30) {
          user.vocabulary = user.vocabulary.slice(-30);
        }
      }

      await saveState(state);

      let vocabText = '';
      if (geminiResult.vocabularyItem?.term) {
        vocabText = `\n\n📚 <b>Modismo / Frase Clave Guardada:</b>\n` +
          `🔤 <code>${formatTelegramHtml(geminiResult.vocabularyItem.term)}</code> - <i>${formatTelegramHtml(geminiResult.vocabularyItem.meaning)}</i>\n` +
          `<i>"${formatTelegramHtml(geminiResult.vocabularyItem.example)}"</i>`;
      }
      const transcriptionBlock = `🎙️ <b>Transcripción de tu audio:</b>\n<blockquote>"${formatTelegramHtml(geminiResult.transcription || geminiResult.englishPhrase)}"</blockquote>\n\n`;
      const pronunciationBlock = geminiResult.pronunciationFeedback
        ? `🗣️ <b>Feedback Oral & Pronunciación:</b>\n${formatTelegramHtml(geminiResult.pronunciationFeedback)}\n\n`
        : '';
      const feedbackBlock = formatTelegramHtml(geminiResult.feedbackHtml || geminiResult.dynamicReply || '');

      const successMsg = `¡Espectacular, <b>${user.name}</b>! 🎉 He registrado tu práctica de hoy:\n\n` +
        transcriptionBlock +
        pronunciationBlock +
        feedbackBlock +
        vocabText + '\n\n' +
        shieldRefundText +
        `Tu racha actual ahora es de 🔥 <b>${user.streak} días</b>.\n` +
        `📊 <i>Nivel actual estimado: <b>${user.profile?.cefrLevel || 'B1'}</b></i>`;

      await sendTelegramMessage(msg.chat.id, successMsg, { reply_markup: createInlineKeyboard() });
      return respond(res, 200, 'Voice note registered');
    }

    // =========================================================================
    // Case 3: Text Message
    // =========================================================================
    if (!msg.text) {
      return respond(res, 200, 'No processable text found in update');
    }

    const text = msg.text.trim();
    const userKey = findUserKey(state, msg);

    if (!userKey) {
      const replyMsg = `Hum... ¡Hola <b>${msg.from.first_name}</b>! 🧐 No reconozco tu usuario de Telegram (<code>@${msg.from.username || 'sin_usuario'}</code>) en este grupo de estudio.\n\n` +
        `Pídele al administrador que configure tu usuario en las variables de entorno (<code>USER_A_USERNAME</code> o <code>USER_B_USERNAME</code>).\n\n` +
        `<i>English note:</i> "Only registered members can join the challenge! Let's get configured first!" ⚙️`;
      
      await sendTelegramMessage(msg.chat.id, replyMsg);
      return respond(res, 200, 'Unregistered user');
    }

    const user = state.users[userKey];

    let detailsChanged = false;
    if (user.id !== msg.from.id.toString()) {
      user.id = msg.from.id.toString();
      detailsChanged = true;
    }
    if (msg.from.username && user.username !== msg.from.username) {
      user.username = msg.from.username;
      detailsChanged = true;
    }
    if (user.name === 'Usuario A' || user.name === 'Usuario B' || !user.name) {
      user.name = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '');
      detailsChanged = true;
    }
    if (msg.chat?.id && state.chatId !== msg.chat.id) {
      state.chatId = msg.chat.id;
      detailsChanged = true;
    }
    if (detailsChanged) {
      await saveState(state);
    }

    // Slash command intercepts (M2, M4, M3)
    if (text.startsWith('/spark')) {
      const resultMsg = await handleSparkCommand(msg.chat.id, state);
      return respond(res, 200, resultMsg);
    }

    if (text.startsWith('/review')) {
      const resultMsg = await handleReviewCommand(msg.chat.id, user, state);
      return respond(res, 200, resultMsg);
    }

    if (text.startsWith('/streak_alert')) {
      const resultMsg = await handleStreakAlertCommand(msg.chat.id, state);
      return respond(res, 200, resultMsg);
    }

    // Call Gemini API with multimodal prompt and structured response
    const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB?.username || state.users.userB?.id);
    let geminiResult = null;
    if (process.env.GEMINI_API_KEY) {
      geminiResult = await callGemini(user, text, state, isUserBActive);
    }

    if (geminiResult) {
      const command = geminiResult.intent;
      const args = geminiResult.englishPhrase || (text.startsWith('/done') ? text.substring(5).trim() : text);

      if (command === 'start') {
        const resultMsg = await handleStartCommand(msg.chat.id, user, state, geminiResult);
        return respond(res, 200, resultMsg);
      }
      if (command === 'shield') {
        const resultMsg = await handleShieldCommand(msg.chat.id, user, state, geminiResult);
        return respond(res, 200, resultMsg);
      }
      if (command === 'status') {
        const resultMsg = await handleStatusCommand(msg.chat.id, state, user, geminiResult);
        return respond(res, 200, resultMsg);
      }
      if (command === 'spark') {
        const resultMsg = await handleSparkCommand(msg.chat.id, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'review') {
        const resultMsg = await handleReviewCommand(msg.chat.id, user, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'done') {
        const resultMsg = await handleDoneCommand(msg.chat.id, user, userKey, args, geminiResult, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'chat') {
        if (geminiResult.dynamicReply) {
          await sendTelegramMessage(msg.chat.id, formatTelegramHtml(geminiResult.dynamicReply), { reply_markup: createInlineKeyboard() });
        }
        return respond(res, 200, 'Casual chat processed');
      }
    }

    // Fallback: Detect heuristic commands starting with "/"
    if (text.startsWith('/')) {
      const firstSpace = text.indexOf(' ');
      const cmdPart = firstSpace === -1 ? text : text.substring(0, firstSpace);
      const args = firstSpace === -1 ? '' : text.substring(firstSpace + 1).trim();
      const command = cmdPart.replace(/^\/(\w+)(@\w+)?$/i, '$1').toLowerCase();

      if (command === 'start') {
        const resultMsg = await handleStartCommand(msg.chat.id, user, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'done') {
        const resultMsg = await handleDoneCommand(msg.chat.id, user, userKey, args, null, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'shield') {
        const resultMsg = await handleShieldCommand(msg.chat.id, user, state);
        return respond(res, 200, resultMsg);
      }
      if (command === 'status') {
        const resultMsg = await handleStatusCommand(msg.chat.id, state, user);
        return respond(res, 200, resultMsg);
      }
    }

    // Natural language text when Gemini is unavailable: enqueue to state.queue
    state.queue = state.queue || [];
    state.queue.push({
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      chatId: msg.chat.id,
      userKey: userKey,
      text: text,
      timestamp: Date.now(),
      attempts: 0
    });
    await saveState(state);

    const queueNotice = `📥 <b>¡Mensaje recibido!</b> En este momento los servidores de IA de Google están experimentando alta demanda. Guardé tu mensaje en la cola de espera y te responderé más tarde de forma automática en cuanto se restablezca el servicio. ¡No perderás tu racha! ⏳`;
    await sendTelegramMessage(msg.chat.id, queueNotice, { reply_markup: createInlineKeyboard() });

    return respond(res, 200, 'Message queued due to Gemini unavailable');

  } catch (err) {
    console.error('Fatal error in webhook handler:', err);
    return respond(res, 500, { error: 'Internal Server Error', details: err.message });
  }
}
