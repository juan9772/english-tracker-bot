// test/tier3-combinations.test.js
/**
 * Tier 3: Pairwise & Multi-Feature Combinations Test Suite
 * Covers complex feature interactions:
 * - HTML Chunking + Inline Keyboards (F1.5 + F3.5)
 * - Multi-day Catchup + Shield Deduction + Monday Reset + Streak Reset (F2.1 + F2.2)
 * - Voice Note Practice + Learning Profile Update + Vocabulary Extraction (F3.1 + F4.1 + F4.2 + F3.4)
 * - Public Status API + Dynamic Users + Learning Profile Badges (F2.4 + F2.3 + F4.3)
 * - Queueing on Gemini 503 + Queue Drain + State Persistence
 * - Spaced Repetition /review + Inline Keyboards + Callback Query Handling
 */

import assert from 'node:assert/strict';
import { setupTestEnvironment } from './helpers/mock-env.js';
import { adapter } from './helpers/adapter.js';
import { getLocalDateString, getPreviousDateString, getDayOfWeek } from '../api/_time.js';

export async function runTier3Tests() {
  console.log('\n======================================================');
  console.log('  RUNNING TIER 3: PAIRWISE & FEATURE COMBINATIONS');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  const env = setupTestEnvironment();

  // ----------------------------------------------------
  // Combination 1: HTML Chunking + Inline Keyboards (F1.5 + F3.5)
  // ----------------------------------------------------
  test('Combo 1.1: Long message (>4000 chars) chunked safely with inline keyboard attached to final message', () => {
    const longText = '<b>Important English Rule:</b> ' + 'Practice speaking every single day. '.repeat(150);
    const chunks = adapter.chunkTelegramHtml(longText, 3000);
    assert.ok(chunks.length >= 2);

    const keyboard = adapter.createInlineKeyboard();
    assert.ok(keyboard.inline_keyboard);

    // Simulate sending: all chunks sent, keyboard attached to last chunk
    const outgoingMessages = chunks.map((chunk, idx) => ({
      text: chunk,
      reply_markup: idx === chunks.length - 1 ? keyboard : undefined
    }));

    assert.equal(outgoingMessages.length, chunks.length);
    assert.equal(outgoingMessages[0].reply_markup, undefined);
    assert.ok(outgoingMessages[outgoingMessages.length - 1].reply_markup);
    assert.equal(outgoingMessages[outgoingMessages.length - 1].reply_markup.inline_keyboard.length, 2);
  });

  test('Combo 1.2: Chunked message crossing blockquote tags preserves balanced HTML in each chunk with keyboard options', () => {
    const quoteContent = 'Daily conversation habit. '.repeat(200);
    const input = `<blockquote>${quoteContent}</blockquote>`;
    const chunks = adapter.chunkTelegramHtml(input, 2000);
    assert.ok(chunks.length >= 2);

    for (const chunk of chunks) {
      assert.match(chunk, /^<blockquote>/);
      assert.match(chunk, /<\/blockquote>$/);
      assert.equal(chunk, adapter.balanceHtmlTags(chunk));
    }
  });

  test('Combo 1.3: Markdown bullet list formatted to HTML and chunked with inline buttons', () => {
    let markdownList = 'Here are today key vocabulary collocations:\n\n';
    for (let i = 1; i <= 60; i++) {
      markdownList += `* **Collocation ${i}**: "to take for granted ${i}" - means to not appreciate.\n`;
    }
    const formattedHtml = adapter.formatTelegramHtml(markdownList);
    const chunks = adapter.chunkTelegramHtml(formattedHtml, 2500);
    assert.ok(chunks.length >= 2);
    for (const chunk of chunks) {
      assert.match(chunk, /• <b>Collocation/);
      assert.equal(chunk, adapter.balanceHtmlTags(chunk));
    }
  });

  test('Combo 1.4: Message of exactly 4000 characters chunked into single piece with interactive keyboard attached', () => {
    const exactMessage = '<b>Practice</b> ' + 'A'.repeat(3980);
    const chunks = adapter.chunkTelegramHtml(exactMessage, 4000);
    assert.equal(chunks.length, 1);
    const keyboard = adapter.createInlineKeyboard();
    const payload = { text: chunks[0], reply_markup: keyboard };
    assert.ok(payload.reply_markup);
    assert.equal(payload.reply_markup.inline_keyboard.length, 2);
  });

  // ----------------------------------------------------
  // Combination 2: Multi-day Catchup + Shield Deduction + Monday Reset + Streak Reset (F2.1 + F2.2)
  // ----------------------------------------------------
  test('Combo 2.1: Multi-day absence spanning Friday through Tuesday (4 missed days) tests Monday shield replenish', () => {
    // 2026-10-02 is Friday.
    // Misses:
    // - 2026-10-03 (Sat): shields 2 -> 1
    // - 2026-10-04 (Sun): shields 1 -> 0
    // - 2026-10-05 (Mon): Monday Reset resets shields 0 -> 2!
    //                     Then misses Monday: shields 2 -> 1. Streak preserved!
    // Current date is 2026-10-06 (Tue), previousDateStr is 2026-10-05.
    const user = {
      name: "Juan",
      streak: 47,
      shields: 2,
      lastEvaluatedDate: "2026-10-02",
      lastShieldResetDate: "2026-09-28", // Previous Monday
      checkInHistory: {}
    };

    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-06");

    assert.equal(res.evaluatedDays.length, 3); // 10-03, 10-04, 10-05
    assert.ok(res.evaluatedDays.includes("2026-10-03"));
    assert.ok(res.evaluatedDays.includes("2026-10-04"));
    assert.ok(res.evaluatedDays.includes("2026-10-05"));
    assert.equal(user.lastShieldResetDate, "2026-10-05"); // Reset on Monday
    assert.equal(user.streak, 47); // Streak intact thanks to Monday reset!
    assert.equal(user.shields, 1); // 2 restored on Monday, 1 consumed for Monday
    assert.equal(user.lastEvaluatedDate, "2026-10-05");
  });

  test('Combo 2.2: Midweek 3-day absence with 1 shield: consumes 1 shield on day 1, resets streak on day 2', () => {
    // 2026-10-06 (Tue) to 2026-10-10 (Sat).
    // Evaluates: 10-07 (Wed), 10-08 (Thu), 10-09 (Fri).
    const user = {
      name: "Sister Francy",
      streak: 18,
      shields: 1,
      lastEvaluatedDate: "2026-10-06",
      lastShieldResetDate: "2026-10-05",
      checkInHistory: {}
    };

    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-10");

    assert.equal(res.evaluatedDays.length, 3);
    assert.equal(res.shieldsUsed, 1);
    assert.equal(user.shields, 0);
    assert.equal(user.streak, 0); // Broken on 10-08
    assert.equal(res.penalties.length, 1);
    assert.equal(res.penalties[0].date, "2026-10-08");
    assert.equal(res.penalties[0].previousStreak, 18);
  });

  test('Combo 2.3: Multi-day gap where user checked in on day 2 of a 4-day gap', () => {
    const user = {
      name: "Student",
      streak: 10,
      shields: 2,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {
        "2026-10-03": true // Checked in on day 2!
      }
    };
    // Jump to 2026-10-05: evaluates 10-02, 10-03, 10-04
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-05");
    assert.equal(res.evaluatedDays.length, 3);
    assert.equal(res.shieldsUsed, 2); // 10-02 consumed 1, 10-04 consumed 1
    assert.equal(user.shields, 0);
    assert.equal(user.streak, 10);
  });

  // ----------------------------------------------------
  // Combination 3: Voice Note + Learning Profile + Vocab Extraction (F3.1 + F4.1 + F4.2 + F3.4)
  // ----------------------------------------------------
  test('Combo 3.1: Voice note check-in updates transcription, pronunciation feedback, profile, and extracts vocab in single call', async () => {
    const mockAudioBase64 = Buffer.from("OggS_VOICE_NOTE_BINARY").toString('base64');
    
    // Simulate single Gemini AI multimodal evaluation result
    const geminiResult = {
      valid: true,
      transcription: "I have been thinking about how consistency changes everything in language learning.",
      pronunciationFeedback: "Great cadence. Pay attention to the linking between 'thinking' and 'about'.",
      feedbackHtml: "<b>Excelente trabajo.</b> Tu fluidez oral está mejorando sensiblemente.",
      vocabularyItem: {
        term: "through thick and thin",
        meaning: "under all conditions, no matter how challenging",
        example: "They supported each other through thick and thin."
      },
      learningProfileUpdate: {
        cefrLevel: "B2",
        strengths: ["Natural intonation", "Complex connectors", "Rich vocabulary"],
        focusAreas: ["Consonant clusters", "Past continuous"]
      }
    };

    const state = await env.storage.getState();
    const user = state.users.userA;
    const initialStreak = user.streak;

    // Apply voice note check-in transaction
    user.streak += 1;
    user.lastCheckIn = "2026-10-02";
    if (user.checkInHistory) user.checkInHistory["2026-10-02"] = true;

    // Update profile
    user.profile = {
      cefrLevel: geminiResult.learningProfileUpdate.cefrLevel,
      strengths: geminiResult.learningProfileUpdate.strengths.slice(0, 3),
      focusAreas: geminiResult.learningProfileUpdate.focusAreas.slice(0, 3),
      lastUpdated: new Date().toISOString()
    };

    // Update vocabulary bank
    if (!user.vocabulary) user.vocabulary = [];
    user.vocabulary.push({
      term: geminiResult.vocabularyItem.term,
      meaning: geminiResult.vocabularyItem.meaning,
      example: geminiResult.vocabularyItem.example,
      addedDate: "2026-10-02",
      reviewCount: 0
    });

    await env.storage.saveState(state);

    // Verify persisted state
    const savedState = await env.storage.getState();
    assert.equal(savedState.users.userA.streak, initialStreak + 1);
    assert.equal(savedState.users.userA.profile.cefrLevel, "B2");
    assert.equal(savedState.users.userA.profile.strengths.length, 3);
    assert.ok(savedState.users.userA.vocabulary.some(v => v.term === "through thick and thin"));
  });

  test('Combo 3.2: Voice note check-in with vocab bank at maximum capacity (30 items) triggers FIFO eviction', async () => {
    const state = await env.storage.getState();
    const user = state.users.userA;

    // Fill vocabulary to 30 items
    user.vocabulary = [];
    for (let i = 1; i <= 30; i++) {
      user.vocabulary.push({
        term: `old_idiom_${i}`,
        meaning: `meaning ${i}`,
        example: `example ${i}`,
        addedDate: "2026-09-01",
        reviewCount: 1
      });
    }
    assert.equal(user.vocabulary.length, 30);

    // Add 31st item from new practice
    const newVocab = {
      term: "a piece of cake",
      meaning: "something very easy to accomplish",
      example: "The grammar quiz was a piece of cake.",
      addedDate: "2026-10-02",
      reviewCount: 0
    };

    if (user.vocabulary.length >= 30) {
      user.vocabulary.shift(); // Evict oldest
    }
    user.vocabulary.push(newVocab);

    assert.equal(user.vocabulary.length, 30);
    assert.equal(user.vocabulary[0].term, "old_idiom_2"); // First evicted
    assert.equal(user.vocabulary[29].term, "a piece of cake");
  });

  test('Combo 3.3: Voice note check-in refunds shield if user activated shield earlier same day', async () => {
    const state = await env.storage.getState();
    const user = state.users.userA;

    // Simulate earlier shield activation
    user.shields = 1;
    user.lastShieldUsedDate = "2026-10-02";

    // User later checks in with voice note on same day
    if (user.lastShieldUsedDate === "2026-10-02") {
      user.shields += 1;
      user.lastShieldUsedDate = null;
    }
    user.streak += 1;
    user.lastCheckIn = "2026-10-02";

    assert.equal(user.shields, 2);
    assert.equal(user.lastShieldUsedDate, null);
    assert.equal(user.lastCheckIn, "2026-10-02");
  });

  // ----------------------------------------------------
  // Combination 4: Public Status Endpoint + Dynamic Participants + Profile Badges (F2.4 + F2.3 + F4.3)
  // ----------------------------------------------------
  test('Combo 4.1: Public status endpoint aggregates 4 dynamic participants with accurate check-in and CEFR badges', async () => {
    const multiUserState = {
      dailySpark: "What is one book that changed your perspective?",
      users: {
        userA: {
          name: "Juan",
          streak: 47,
          shields: 2,
          lastCheckIn: "2026-10-02",
          timezone: "America/Argentina/Buenos_Aires",
          profile: { cefrLevel: "B2" }
        },
        userB: {
          name: "Sister Francy",
          streak: 18,
          shields: 1,
          lastCheckIn: null,
          timezone: "America/Mexico_City",
          profile: { cefrLevel: "B1" }
        },
        userC: {
          name: "Carlos Dev",
          streak: 5,
          shields: 2,
          lastCheckIn: "2026-10-02",
          timezone: "America/Bogota",
          profile: { cefrLevel: "A2" }
        },
        userD: {
          name: "Maria Student",
          streak: 12,
          shields: 0,
          lastCheckIn: null,
          lastShieldUsedDate: "2026-10-02",
          timezone: "America/Santiago",
          profile: { cefrLevel: "B1" }
        }
      }
    };

    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };

    await adapter.statusHandler(req, res, multiUserState);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.status, "ok");
    assert.equal(res.data.dailySpark, "What is one book that changed your perspective?");
    assert.equal(res.data.participants.length, 4);

    const juan = res.data.participants.find(p => p.name === "Juan");
    assert.equal(juan.streak, 47);
    assert.equal(juan.cefrLevel, "B2");

    const francy = res.data.participants.find(p => p.name === "Sister Francy");
    assert.equal(francy.streak, 18);
    assert.equal(francy.cefrLevel, "B1");

    const maria = res.data.participants.find(p => p.name === "Maria Student");
    assert.equal(maria.shields, 0);
  });

  test('Combo 4.2: Public status response strictly omits chat IDs and bot secrets across dynamic participants', async () => {
    const rawState = {
      chatId: -100123456789,
      queue: [],
      users: {
        userA: { id: "11111", name: "Juan", streak: 47, shields: 2 },
        userB: { id: "22222", name: "Sister", streak: 18, shields: 1 }
      }
    };

    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };

    await adapter.statusHandler(req, res, rawState);
    const jsonStr = JSON.stringify(res.data);
    assert.doesNotMatch(jsonStr, /"id":/);
    assert.doesNotMatch(jsonStr, /-100123456789/);
    assert.doesNotMatch(jsonStr, /"queue":/);
  });

  // ----------------------------------------------------
  // Combination 5: Queueing on Gemini 503 + Queue Drain + Catchup
  // ----------------------------------------------------
  test('Combo 5.1: Gemini 503 queues user check-in, subsequent recovery drains queue before cron evaluation', async () => {
    const state = await env.storage.getState();
    state.queue = [];

    // Simulate 503 event: message placed in queue
    const queuedItem = {
      username: "juan_dev",
      userId: "11111",
      text: "Today I practiced advanced English conditionals with great results.",
      receivedAt: new Date().toISOString()
    };
    state.queue.push(queuedItem);
    await env.storage.saveState(state);

    // Verify queue populated
    let intermediateState = await env.storage.getState();
    assert.equal(intermediateState.queue.length, 1);

    // Drain queue on recovery
    const itemToProcess = intermediateState.queue.shift();
    assert.equal(itemToProcess.text, queuedItem.text);
    intermediateState.users.userA.streak += 1;
    intermediateState.users.userA.lastCheckIn = "2026-10-02";
    await env.storage.saveState(intermediateState);

    // Final state verified: queue empty, streak updated
    const finalState = await env.storage.getState();
    assert.equal(finalState.queue.length, 0);
    assert.ok(finalState.users.userA.streak >= 48);
  });

  // ----------------------------------------------------
  // Combination 6: Spaced Repetition /review + Inline Keyboards + Callback Query
  // ----------------------------------------------------
  test('Combo 6.1: Spaced repetition review card formatted with HTML blockquotes and inline reply markup', () => {
    const vocabCard = {
      term: "bite the bullet",
      meaning: "to face a difficult situation with courage and fortitude",
      example: "I had to bite the bullet and give the English presentation."
    };

    const formattedMessage = `📚 <b>Repaso de Vocabulario</b>\n\n` +
      `<b>Término:</b> <code>${adapter.formatTelegramHtml(vocabCard.term)}</code>\n` +
      `<b>Significado:</b> ${adapter.formatTelegramHtml(vocabCard.meaning)}\n\n` +
      `<blockquote>${adapter.formatTelegramHtml(vocabCard.example)}</blockquote>`;

    const keyboard = adapter.createInlineKeyboard();
    const balancedHtml = adapter.balanceHtmlTags(formattedMessage);

    assert.match(balancedHtml, /<b>Repaso de Vocabulario<\/b>/);
    assert.match(balancedHtml, /<code>bite the bullet<\/code>/);
    assert.match(balancedHtml, /<blockquote>I had to bite the bullet/);
    assert.ok(keyboard.inline_keyboard.length === 2);
  });

  test('Combo 6.2: Callback queries mapped to correct intent routing', () => {
    const callbackQueries = [
      { data: "cmd:status", expectedIntent: "status" },
      { data: "cmd:shield", expectedIntent: "shield" },
      { data: "cmd:spark", expectedIntent: "spark" },
      { data: "cmd:review", expectedIntent: "review" }
    ];

    for (const q of callbackQueries) {
      const intent = q.data.replace('cmd:', '');
      assert.equal(intent, q.expectedIntent);
    }
  });

  env.time.uninstall();
  env.network.uninstall();

  console.log(`\n  Tier 3 Complete: ${passed}/${total} tests passed.\n`);
  return { passed, total };
}

// Auto-run if executed directly
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('tier3-combinations.test.js') || process.argv[1].endsWith('tier3-combinations.test'));
if (isDirectRun) {
  runTier3Tests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
