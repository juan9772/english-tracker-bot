import { getState, saveState, findUserKey } from './_db.js';
import { sendTelegramMessage } from './_telegram.js';
import { getLocalDateString } from './_time.js';
import { callGemini, executeParsedCommand, processQueue } from './_queue.js';

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
  // Ensure it's a POST request
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
  
  // Log update for debugging in Vercel logs
  console.log('Received Telegram Update:', JSON.stringify(update));

  const msg = update.message;
  if (!msg || !msg.text) {
    return respond(res, 200, 'No processable text found in update');
  }

  const text = msg.text.trim();

  try {
    const state = await getState();

    // Process any previously queued messages first
    if (state.queue && state.queue.length > 0) {
      await processQueue(state);
    }

    const userKey = findUserKey(state, msg);

    if (!userKey) {
      const replyMsg = `Hum... ¡Hola <b>${msg.from.first_name}</b>! 🧐 No reconozco tu usuario de Telegram (<code>@${msg.from.username || 'sin_usuario'}</code>) en este grupo de estudio.\n\n` +
        `Pídele al administrador que configure tu usuario en las variables de entorno (<code>USER_A_USERNAME</code> o <code>USER_B_USERNAME</code>).\n\n` +
        `<i>English note:</i> "Only registered members can join the challenge! Let's get configured first!" ⚙️`;
      
      await sendTelegramMessage(msg.chat.id, replyMsg);
      return respond(res, 200, 'Unregistered user');
    }

    const user = state.users[userKey];

    // Dynamically update user details in storage
    user.id = msg.from.id.toString();
    user.username = msg.from.username || null;
    
    // Set custom display name if it's the default placeholder
    if (user.name === 'Usuario A' || user.name === 'Usuario B' || !user.name) {
      user.name = msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : '');
    }

    // Save group chat ID for cron announcements
    if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
      state.chatId = msg.chat.id;
    }

    // Call Gemini API with retries and fallback models
    const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB.username || state.users.userB.id);
    let geminiResult = null;
    if (process.env.GEMINI_API_KEY) {
      geminiResult = await callGemini(user, text, state, isUserBActive);
    }

    if (geminiResult) {
      const command = geminiResult.intent;
      const args = geminiResult.englishPhrase || '';
      const resultMsg = await executeParsedCommand(user, userKey, command, args, geminiResult, msg.chat.id, state);
      return respond(res, 200, resultMsg);
    }

    // Fallback: Detect commands starting with "/"
    if (text.startsWith('/')) {
      const firstSpace = text.indexOf(' ');
      const cmdPart = firstSpace === -1 ? text : text.substring(0, firstSpace);
      const args = firstSpace === -1 ? '' : text.substring(firstSpace + 1).trim();
      const command = cmdPart.replace(/^\/(\w+)(@\w+)?$/i, '$1').toLowerCase();

      const ALLOWED_COMMANDS = ['start', 'done', 'shield', 'status'];
      if (ALLOWED_COMMANDS.includes(command)) {
        const resultMsg = await executeParsedCommand(user, userKey, command, args, null, msg.chat.id, state);
        return respond(res, 200, resultMsg);
      }
    }

    // If natural language text and Gemini failed: enqueue message to queue
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
    await sendTelegramMessage(msg.chat.id, queueNotice);

    return respond(res, 200, 'Message queued due to Gemini unavailable');

  } catch (err) {
    console.error('Fatal error in webhook handler:', err);
    return respond(res, 500, { error: 'Internal Server Error', details: err.message });
  }
}
