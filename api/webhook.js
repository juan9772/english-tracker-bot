import { getState, saveState, findUserKey } from './_db.js';
import { sendTelegramMessage } from './_telegram.js';
import { getLocalDateString } from './_time.js';

async function callGemini(user, text, state, isUserBActive) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const currentDateStr = getLocalDateString(new Date(), user.timezone);
  const isAlreadyDone = user.lastCheckIn === currentDateStr;
  const isAlreadyShielded = user.lastShieldUsedDate === currentDateStr;

  const systemInstructionText = `
Eres el cerebro de un bot de Telegram inteligente e informal llamado "English Tracker Bot". Tu objetivo es registrar la práctica de inglés de dos estudiantes: Juan (de Argentina, usa español rioplatense informal con che, racha, etc.) y su hermana/compañera (de México, usa español mexicano).

Tu tarea es analizar el mensaje del usuario y responder con un JSON estructurado que contenga:
1. "intent": Clasificación de la intención del mensaje. Valores posibles:
   - "start": Saludos iniciales, registro, bienvenida o preguntas de cómo usar el bot.
   - "shield": Solicitud para usar un escudo protector hoy (ej. "escudo", "ponme escudo", "hoy no puedo estudiar", "necesito descanso").
   - "status": Consulta de racha, escudos o estado (ej. "cómo voy?", "status", "ver racha", "estado").
   - "done": Envío de una frase en inglés para registrar la práctica.
   - "chat": Conversación casual, agradecimientos ("gracias", "ok", "jaja"), o mensajes breves que no son comandos ni frases.
2. "englishPhrase": (Solo para "done") La frase en inglés extraída y limpia de prefijos en español (ej. si dice "hoy aprendí: Today is sunny", extraer "Today is sunny").
3. "isEnglishValid": (Solo para "done") true si la frase está en inglés, tiene 10 o más caracteres de texto en inglés y tiene coherencia para ser una práctica. De lo contrario, false.
4. "dynamicReply": Una respuesta en español personalizada para el usuario (usando jerga de Argentina si es Juan, o de México si es su compañera).
   - Si es "start": bienvenida y explicación alegre de cómo usar el bot (sin usar barras "/" si no quieren).
   - Si es "shield": confirmación de que descanse tranquilo (menciona si ya lo había activado o si ya hizo la tarea hoy basándote en los datos del usuario).
   - Si es "done" y es válida: felicitación alegre y un tip gramatical muy breve o sugerencia de vocabulario sobre su frase en inglés.
   - Si es "done" pero no es válida: advertencia graciosa y educativa de por qué no califica (muy corta, español o inconexa) y sugerencias.
   - Si es "chat": respuesta corta y simpática. Si el mensaje es una conversación grupal casual e irrelevante donde no se dirigen al bot ni requiere respuesta, pon "dynamicReply" como un string vacío "".
`;

  const promptContent = `
DATOS DEL USUARIO:
- Nombre: ${user.name}
- Rol: ${user.timezone.includes('Buenos_Aires') ? 'Juan (Argentina)' : 'México'}
- Racha actual: ${user.streak} días
- Escudos restantes: ${user.shields} / 2
- ¿Ya hizo check-in hoy? ${isAlreadyDone ? 'Sí' : 'No'}
- ¿Ya usó escudo hoy? ${isAlreadyShielded ? 'Sí' : 'No'}
- Fecha local del usuario: ${currentDateStr}

MENSAJE DEL USUARIO:
"${text}"
`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstructionText }]
        },
        contents: [
          {
            parts: [{ text: promptContent }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              intent: {
                type: "STRING",
                enum: ["start", "done", "shield", "status", "chat"]
              },
              englishPhrase: { type: "STRING" },
              isEnglishValid: { type: "BOOLEAN" },
              dynamicReply: { type: "STRING" }
            },
            required: ["intent", "dynamicReply"]
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", errText);
      return null;
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) return null;

    return JSON.parse(resultText);
  } catch (err) {
    console.error("Failed to call Gemini API:", err);
    return null;
  }
}

export default async function handler(req, res) {
  // Ensure it's a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const update = req.body;
  
  // Log update for debugging in Vercel logs
  console.log('Received Telegram Update:', JSON.stringify(update));

  const msg = update.message;
  if (!msg || !msg.text) {
    return res.status(200).send('No processable text found in update');
  }

  const text = msg.text.trim();

  try {
    const state = await getState();
    const userKey = findUserKey(state, msg);

    if (!userKey) {
      const replyMsg = `Hum... ¡Hola <b>${msg.from.first_name}</b>! 🧐 No reconozco tu usuario de Telegram (<code>@${msg.from.username || 'sin_usuario'}</code>) en este grupo de estudio.\n\n` +
        `Pídele al administrador que configure tu usuario en las variables de entorno (<code>USER_A_USERNAME</code> o <code>USER_B_USERNAME</code>).\n\n` +
        `<i>English note:</i> "Only registered members can join the challenge! Let's get configured first!" ⚙️`;
      
      await sendTelegramMessage(msg.chat.id, replyMsg);
      return res.status(200).send('Unregistered user');
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

    const currentDateStr = getLocalDateString(new Date(), user.timezone);

    // Call Gemini API to parse natural language intent
    const isUserBActive = !!(process.env.USER_B_USERNAME || state.users.userB.username || state.users.userB.id);
    let geminiResult = null;
    if (process.env.GEMINI_API_KEY) {
      geminiResult = await callGemini(user, text, state, isUserBActive);
    }

    let command = '';
    let args = '';

    if (geminiResult) {
      command = geminiResult.intent;
      args = geminiResult.englishPhrase || '';
    } else {
      // Fallback: Detect commands starting with "/"
      if (!text.startsWith('/')) {
        return res.status(200).send('Not a command');
      }

      // Parse command name and args
      const firstSpace = text.indexOf(' ');
      const cmdPart = firstSpace === -1 ? text : text.substring(0, firstSpace);
      args = firstSpace === -1 ? '' : text.substring(firstSpace + 1).trim();

      // Clean trailing bot username (e.g. /status@eng_tracker_bot -> status)
      command = cmdPart.replace(/^\/(\w+)(@\w+)?$/i, '$1').toLowerCase();

      const ALLOWED_COMMANDS = ['start', 'done', 'shield', 'status'];
      if (!ALLOWED_COMMANDS.includes(command)) {
        return res.status(200).send('Command ignored');
      }
    }

    if (command === 'chat') {
      if (geminiResult && geminiResult.dynamicReply) {
        await sendTelegramMessage(msg.chat.id, geminiResult.dynamicReply);
      }
      return res.status(200).send('Casual chat processed');
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

      await sendTelegramMessage(msg.chat.id, welcome);
      return res.status(200).send('Start command processed');
    }

    if (command === 'done') {
      const isEnglishValid = geminiResult ? geminiResult.isEnglishValid : (args && args.length >= 10);

      // Validate length/validity of phrase
      if (!isEnglishValid) {
        const exampleText = geminiResult && geminiResult.dynamicReply ?
          `¡Epa, <b>${user.name}</b>! 🚨\n\n` +
          `<i>${geminiResult.dynamicReply}</i>` :
          `¡Epa, <b>${user.name}</b>! 🚨 La frase de hoy debe tener al menos 10 caracteres para contar como práctica real. ¡No me hagas trampa! 😉\n\n` +
          `Intenta escribir algo que hayas aprendido, leído o escuchado hoy. Por ejemplo:\n` +
          `👉 <code>/done Today I learned the difference between "make" and "do".</code>\n` +
          `👉 <code>/done I read a short article in English and practiced my listening.</code>\n\n` +
          `<i>Try again!</i> "You can do better, I believe in you! 💪"`;
        
        await sendTelegramMessage(msg.chat.id, exampleText);
        return res.status(200).send('Done phrase too short or invalid');
      }

      // Check if already checked in
      if (user.lastCheckIn === currentDateStr) {
        const doubleCheckInMsg = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
          `¡Che, <b>${user.name}</b>! Ya registré tu práctica de hoy. ¡No hace falta que lo hagas de nuevo! 🌟\n\n` +
          `<i>Well done!</i> "Keep shining and enjoy your rest! ✨"`;
        
        await sendTelegramMessage(msg.chat.id, doubleCheckInMsg);
        return res.status(200).send('Done already registered');
      }

      // If user had used a shield today but now does /done, refund the shield!
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

      await sendTelegramMessage(msg.chat.id, successMsg);
      return res.status(200).send('Done registered');
    }

    if (command === 'shield') {
      if (user.lastCheckIn === currentDateStr) {
        const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
          `¡Che, <b>${user.name}</b>! Hoy ya hiciste tu check-in de inglés, así que no necesitas gastar un escudo. ¡Guárdalo para cuando de verdad te haga falta! 😉\n\n` +
          `<i>Good decision!</i> "Use your shields wisely! 🛡️"`;
        
        await sendTelegramMessage(msg.chat.id, reply);
        return res.status(200).send('Shield ignored - already done');
      }

      if (user.lastShieldUsedDate === currentDateStr) {
        const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
          `¡Ojo! Hoy ya activaste tu escudo protector, <b>${user.name}</b>. ¡Estás a salvo por hoy! 🛡️ Descansa tranquilo.\n\n` +
          `<i>Take it easy!</i> "Enjoy your day off! 🍕"`;
        
        await sendTelegramMessage(msg.chat.id, reply);
        return res.status(200).send('Shield ignored - already used');
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
        
        await sendTelegramMessage(msg.chat.id, reply);
        return res.status(200).send('Shield activated');
      } else {
        const reply = geminiResult && geminiResult.dynamicReply ? geminiResult.dynamicReply :
          `¡Uf, qué mala suerte, <b>${user.name}</b>! 😰 Ya no te quedan escudos disponibles para esta semana (recuerda que se resetean los lunes). ¡Vas a tener que meterle pata y hacer <code>/done</code> para no perder la racha!\n\n` +
          `<i>Don't give up!</i> "No pain, no gain! You've got this! 💥"`;
        
        await sendTelegramMessage(msg.chat.id, reply);
        return res.status(200).send('Shield failed - no shields left');
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
        `👦 <b>${state.users.userA.name}</b> (Argentina 🇦🇷)\n` +
        `🔥 <b>Racha:</b> ${state.users.userA.streak} días\n` +
        `🛡️ <b>Escudos:</b> ${state.users.userA.shields} / 2\n` +
        `⚡ <b>Hoy:</b> ${statusA}\n\n` +
        `👧 <b>${state.users.userB.name}</b> (México 🇲🇽)\n` +
        `${streakB}\n` +
        `${shieldsB}\n` +
        `⚡ <b>Hoy:</b> ${statusB}\n\n` +
        `<i>Quote of the day:</i> "Success is the sum of small efforts, repeated day in and day out." 💪`;

      await sendTelegramMessage(msg.chat.id, report);
      return res.status(200).send('Status command processed');
    }

  } catch (err) {
    console.error('Fatal error in webhook handler:', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
