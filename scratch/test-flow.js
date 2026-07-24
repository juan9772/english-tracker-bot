import webhookHandler from '../api/webhook.js';
import cronHandler from '../api/cron.js';
import { getState, setMockState } from '../api/_db.js';
import { getLocalDateString, getPreviousDateString } from '../api/_time.js';

// Setup Mock Environment
process.env.MOCK_KV = 'true';
process.env.USER_A_USERNAME = 'user_a_username';
process.env.USER_A_NAME = 'User A';
process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token';
process.env.TELEGRAM_CHAT_ID = '-100123456789';
process.env.GEMINI_API_KEY = 'mock_gemini_api_key';

let geminiSimulatedStatus = 200;

// Intercept Fetch calls
const fetchCalls = [];
globalThis.fetch = async (url, options) => {
  const body = options && options.body ? JSON.parse(options.body) : {};
  
  if (url.includes('generativelanguage.googleapis.com')) {
    if (geminiSimulatedStatus !== 200) {
      return {
        ok: false,
        status: geminiSimulatedStatus,
        text: async () => JSON.stringify({
          error: {
            code: geminiSimulatedStatus,
            message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
            status: "UNAVAILABLE"
          }
        })
      };
    }

    const promptText = body.contents?.[0]?.parts?.[0]?.text || '';
    
    // Extract user message from promptText
    const match = promptText.match(/MENSAJE DEL USUARIO:\s*\n"([\s\S]*?)"/);
    const userMessage = match ? match[1].trim() : '';

    let intent = 'chat';
    let englishPhrase = '';
    let isEnglishValid = false;
    let dynamicReply = '';

    const lowerMsg = userMessage.toLowerCase();
    const alreadyDone = promptText.includes('¿Ya hizo check-in hoy? Sí');
    const alreadyShielded = promptText.includes('¿Ya usó escudo hoy? Sí');
    const shieldsLeft = !promptText.includes('Escudos restantes: 0 / 2');

    if (lowerMsg.startsWith('/start') || ['start', 'iniciar', 'empezar', 'hola', 'hi', 'hello'].some(kw => lowerMsg.includes(kw))) {
      intent = 'start';
      dynamicReply = '¡Hola! Bienvenidos a nuestro rincón de constancia en inglés. 🇬🇧 Aquí vamos a asegurarnos de que practiques todos los días.';
    } else if (lowerMsg.startsWith('/status') || ['status', 'estado', 'racha', 'como vamos', 'cómo vamos'].some(kw => lowerMsg.includes(kw))) {
      intent = 'status';
      dynamicReply = 'Che, te paso el estado de constancia:';
    } else if (lowerMsg.startsWith('/shield') || ['shield', 'escudo', 'usar escudo', 'gastar escudo'].some(kw => lowerMsg.includes(kw))) {
      intent = 'shield';
      if (alreadyDone) {
        dynamicReply = '¡Che! Hoy ya hiciste tu check-in de inglés, así que no necesitas gastar un escudo. ¡Guárdalo para cuando de verdad te haga falta! 😉';
      } else if (alreadyShielded) {
        dynamicReply = '¡Ojo! Hoy ya activaste tu escudo protector. ¡Estás a salvo por hoy! 🛡️ Descansa tranquilo.';
      } else if (!shieldsLeft) {
        dynamicReply = '¡Uf, qué mala suerte! 😰 Ya no te quedan escudos disponibles para esta semana. ¡Vas a tener que meterle pata!';
      } else {
        dynamicReply = '🛡️ Escudo activado para hoy. Quedas libre del inglés por este día.';
      }
    } else {
      // It's a done command (check-in)
      intent = 'done';
      let phrase = userMessage;
      if (phrase.startsWith('/done')) {
        phrase = phrase.substring(5).trim();
      }
      englishPhrase = phrase;
      isEnglishValid = phrase.length >= 10;

      if (alreadyDone) {
        dynamicReply = '¡Che! Ya registré tu práctica de hoy. ¡No hace falta que lo hagas de nuevo! 🌟';
      } else if (isEnglishValid) {
        dynamicReply = `¡Espectacular! He registrado tu frase: "${phrase}". (Minitip gramatical: ¡sigue así!).`;
      } else {
        dynamicReply = '¡Epa! La frase de hoy debe tener al menos 10 caracteres para contar como práctica real. ¡No me hagas trampa! 😉';
      }
    }

    const responseJson = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  intent,
                  englishPhrase,
                  isEnglishValid,
                  dynamicReply
                })
              }
            ]
          }
        }
      ]
    };

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responseJson),
      json: async () => responseJson
    };
  }

  fetchCalls.push({ url, body });
  return {
    ok: true,
    status: 200,
    text: async () => '{"ok":true}',
    json: async () => ({ ok: true })
  };
};

// Control Time Mocking
let mockNow = new Date('2026-07-12T12:00:00Z'); // Starts on Sunday noon UTC
const RealDate = Date;
class MockDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) {
      super(mockNow);
    } else {
      super(...args);
    }
  }
  static now() {
    return mockNow.getTime();
  }
}
globalThis.Date = MockDate;

function advanceTime(ms) {
  mockNow = new RealDate(mockNow.getTime() + ms);
}

function clearFetchCalls() {
  fetchCalls.length = 0;
}

// Helper to simulate webhook request
async function sendWebhookMessage(username, text, userId = '11111', chatType = 'supergroup') {
  const req = {
    method: 'POST',
    body: {
      update_id: Math.floor(Math.random() * 100000),
      message: {
        message_id: Math.floor(Math.random() * 10000),
        from: {
          id: userId,
          first_name: username === 'user_a_username' ? 'User A' : 'User B',
          username: username
        },
        chat: {
          id: -100123456789,
          title: 'English Study Group',
          type: chatType
        },
        date: Math.floor(MockDate.now() / 1000),
        text: text
      }
    }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    send(data) {
      responseData = data;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    }
  };

  await webhookHandler(req, res);
  return { statusCode, responseData };
}

// Helper to simulate cron run
async function triggerCron() {
  const req = {
    headers: {
      authorization: 'Bearer mock_secret'
    }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    }
  };

  await cronHandler(req, res);
  return { statusCode, responseData };
}

// Assertion helper
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('🏁 Starting English Study Bot Offline Integration Tests...');

  // Initialize DB Mock State
  setMockState(null);

  // --- TEST CASE 1: Start Command ---
  console.log('\n--- Test 1: Register User A with /start ---');
  clearFetchCalls();
  const res1 = await sendWebhookMessage('user_a_username', 'hola bot');
  
  assert(res1.statusCode === 200, 'Webhook returns 200 on /start');
  assert(fetchCalls.length === 1, 'Sent exactly 1 Telegram message');
  assert(fetchCalls[0].body.text.includes('Bienvenidos a nuestro rincón'), 'Welcome message sent');
  
  let state = await getState();
  assert(state.chatId === -100123456789, 'Chat ID is saved in state');
  assert(state.users.userA.id === '11111', 'User A ID is registered');
  assert(state.users.userA.username === 'user_a_username', 'User A username is registered');

  // --- TEST CASE 2: Invalid /done phrase length ---
  console.log('\n--- Test 2: Validation of short phrase on /done ---');
  clearFetchCalls();
  const res2 = await sendWebhookMessage('user_a_username', 'short');
  assert(fetchCalls.length === 1, 'Telegram message sent');
  assert(fetchCalls[0].body.text.includes('al menos 10 caracteres'), 'Warning about short phrase sent');
  
  state = await getState();
  assert(state.users.userA.streak === 0, 'Streak remains 0');

  // --- TEST CASE 3: Valid /done command ---
  console.log('\n--- Test 3: Valid check-in on /done ---');
  clearFetchCalls();
  const res3 = await sendWebhookMessage('user_a_username', 'Today I learned dynamic imports in Node ESM.');
  assert(fetchCalls.length === 1, 'Success message sent to Telegram');
  assert(fetchCalls[0].body.text.includes('Tu racha actual ahora es de 🔥 <b>1 días</b>'), 'Correct streak announced');
  
  state = await getState();
  assert(state.users.userA.streak === 1, 'Streak is updated to 1 in DB');
  assert(state.users.userA.lastCheckIn === getLocalDateString(new Date(), state.users.userA.timezone), 'lastCheckIn date matches today');

  // --- TEST CASE 4: Done already registered today ---
  console.log('\n--- Test 4: Prevent double check-in ---');
  clearFetchCalls();
  const res4 = await sendWebhookMessage('user_a_username', 'Today I also learned how to use Vercel Serverless KV.');
  assert(fetchCalls.length === 1, 'Message about already registering today sent');
  assert(fetchCalls[0].body.text.includes('Ya registré tu práctica de hoy'), 'Double check-in ignored message matches');
  
  state = await getState();
  assert(state.users.userA.streak === 1, 'Streak remains 1');

  // --- TEST CASE 5: Use shield command ---
  console.log('\n--- Test 5: Try to use shield after already completing the day ---');
  clearFetchCalls();
  const res5 = await sendWebhookMessage('user_a_username', 'necesito un escudo');
  assert(fetchCalls[0].body.text.includes('no necesitas gastar un escudo'), 'Correctly tells user shield is not needed');
  
  state = await getState();
  assert(state.users.userA.shields === 2, 'Shields count remains 2');

  // Advance time by 1 day (now Monday afternoon)
  console.log('\n>>> Advancing time by 24 hours (into Monday)...');
  advanceTime(24 * 60 * 60 * 1000);

  // Trigger cron on Monday to initialize safety net and perform Monday shield reset
  console.log('\n>>> Triggering cron on Monday to initialize safety net and reset shields...');
  clearFetchCalls();
  const cronResInitial = await triggerCron();
  assert(cronResInitial.statusCode === 200, 'Cron triggers successfully on Monday');
  assert(fetchCalls.some(c => c.body.text.includes('se han restablecido a <b>2</b>')), 'Shields reset notification was sent');

  // --- TEST CASE 6: Use shield on new day ---
  console.log('\n--- Test 6: Activate shield on a blank day ---');
  clearFetchCalls();
  const res6 = await sendWebhookMessage('user_a_username', 'quiero usar mi escudo');
  assert(fetchCalls[0].body.text.includes('Escudo activado para hoy'), 'Confirmation of shield activation sent');
  assert(fetchCalls[0].body.text.includes('Te quedan <b>1 escudos</b>'), 'Correct shields count reported');
  
  state = await getState();
  assert(state.users.userA.shields === 1, 'Shields decremented to 1 in DB');
  assert(state.users.userA.lastShieldUsedDate === getLocalDateString(new Date(), state.users.userA.timezone), 'lastShieldUsedDate recorded');

  // --- TEST CASE 7: Shield Refund when checking in later ---
  console.log('\n--- Test 7: Refund shield when checking in later same day ---');
  clearFetchCalls();
  const res7 = await sendWebhookMessage('user_a_username', 'I decided to study English after all today!');
  assert(fetchCalls[0].body.text.includes('te devolví el escudo'), 'Refund notification present in success message');
  assert(fetchCalls[0].body.text.includes('Tu racha actual ahora es de 🔥 <b>2 días</b>'), 'Streak increased to 2');
  
  state = await getState();
  assert(state.users.userA.shields === 2, 'Shield refunded back to 2');
  assert(state.users.userA.lastShieldUsedDate === null, 'lastShieldUsedDate cleared');
  assert(state.users.userA.lastCheckIn === getLocalDateString(new Date(), state.users.userA.timezone), 'lastCheckIn recorded');

  // --- TEST CASE 8: Status check ---
  console.log('\n--- Test 8: Get status of participants ---');
  clearFetchCalls();
  const res8 = await sendWebhookMessage('user_a_username', 'ver racha');
  assert(fetchCalls[0].body.text.includes('Racha:</b> 2 días'), 'Status shows correct streak for Juan');
  assert(fetchCalls[0].body.text.includes('Escudos:</b> 2 / 2'), 'Status shows correct shields for Juan');
  assert(fetchCalls[0].body.text.includes('Esperando conexión...'), 'Sister displays as waiting for connection');

  // --- TEST CASE 9: Cron running (User completed) ---
  console.log('\n>>> Advancing time by 24 hours (into Tuesday afternoon)...');
  advanceTime(24 * 60 * 60 * 1000);
  clearFetchCalls();
  const cronRes9 = await triggerCron();
  assert(cronRes9.statusCode === 200, 'Cron triggers successfully');
  assert(fetchCalls.some(c => c.body.text.includes('Verificación Diaria')), 'Cron execution notification message was sent');
  
  state = await getState();
  assert(state.users.userA.lastEvaluatedDate === getPreviousDateString(getLocalDateString(new Date(), state.users.userA.timezone)), 'lastEvaluatedDate updated to yesterday');

  // --- TEST CASE 10: Gemini 503 Error and Message Queueing ---
  console.log('\n--- Test 10: Gemini 503 Error & Queueing Message ---');
  geminiSimulatedStatus = 503;
  clearFetchCalls();

  const res10 = await sendWebhookMessage('user_a_username', 'Today I learned about exponential backoff retries and queueing.');
  assert(res10.responseData === 'Message queued due to Gemini unavailable', 'Webhook queued message when Gemini returned 503');
  assert(fetchCalls.length === 1, 'Sent Telegram notice to user');
  assert(fetchCalls[0].body.text.includes('Guardé tu mensaje en la cola de espera y te responderé más tarde'), 'Telegram notice informed user they will be answered later');

  state = await getState();
  assert(state.queue && state.queue.length === 1, '1 item present in state.queue');
  assert(state.queue[0].text === 'Today I learned about exponential backoff retries and queueing.', 'Queued text matches');

  // --- TEST CASE 11: Drain Queue when Gemini recovers ---
  console.log('\n--- Test 11: Drain Queue when Gemini recovers ---');
  geminiSimulatedStatus = 200; // Gemini is back online!
  clearFetchCalls();

  // Triggering cron or next webhook drains the queue
  await triggerCron();

  state = await getState();
  assert(!state.queue || state.queue.length === 0, 'Queue is empty after drain');
  assert(state.users.userA.streak === 3, 'Streak increased to 3 after processing queued check-in');
  assert(fetchCalls.some(c => c.body.text.includes('Tu racha actual ahora es de 🔥 <b>3 días</b>')), 'Sent completion Telegram response for queued item');

  // --- TEST CASE 12: Cron running (User missed Wednesday, Auto-shield consumption on Thursday) ---
  console.log('\n>>> Advancing time by 48 hours (into Thursday afternoon, User A missed Wednesday) ...');
  advanceTime(48 * 60 * 60 * 1000);
  clearFetchCalls();
  
  const cronRes12 = await triggerCron();
  assert(cronRes12.statusCode === 200, 'Cron triggers successfully');
  assert(fetchCalls.some(c => c.body.text.includes('se ha salvado usando un escudo automático')), 'Shield warning content matches');
  
  state = await getState();
  assert(state.users.userA.shields === 1, 'Shield count decremented to 1 by cron');
  assert(state.users.userA.streak === 3, 'Streak is saved and stays at 3');

  // --- TEST CASE 13: Cron running (User missed Thursday, no shields left -> Reset Streak & Penalty) ---
  console.log('\n>>> Advancing time by 24 hours (into Friday afternoon, User A missed Thursday)...');
  advanceTime(24 * 60 * 60 * 1000);
  
  // Consume the remaining shield (Thursday transition)
  clearFetchCalls();
  await triggerCron(); // This consumes the 2nd shield
  
  state = await getState();
  assert(state.users.userA.shields === 0, 'Shields count is now 0');
  assert(state.users.userA.streak === 3, 'Streak is still 3');

  console.log('\n>>> Advancing time by 24 hours (into Saturday afternoon, User A missed Friday, 0 shields left)...');
  advanceTime(24 * 60 * 60 * 1000);
  clearFetchCalls();
  
  await triggerCron(); // No shields left!
  assert(fetchCalls.some(c => c.body.text.includes('LA CONSTANCIA SE HA ROTO')), 'Broken streak banner present');
  assert(fetchCalls.some(c => c.body.text.includes('PENALIZACIÓN:')), 'Penalty details present');
  
  state = await getState();
  assert(state.users.userA.streak === 0, 'Streak is reset to 0');

  // --- TEST CASE 14: Weekly reset on Monday ---
  console.log('\n>>> Advancing time to next Monday afternoon...');
  advanceTime(2 * 24 * 60 * 60 * 1000);
  clearFetchCalls();
  
  await triggerCron();
  assert(fetchCalls.some(c => c.body.text.includes('se han restablecido a <b>2</b>')), 'Shields reset notification was sent');
  
  state = await getState();
  assert(state.users.userA.shields === 1, 'Shields reset to 2 on Monday and then 1 consumed for missed Sunday');

  console.log('\n🎉 ALL OFFLINE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test execution failed with error:', err);
  process.exit(1);
});
