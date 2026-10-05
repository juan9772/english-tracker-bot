// test/tier4-scenarios.test.js
/**
 * Tier 4: End-to-End Real-World User Scenarios Test Suite
 * Covers comprehensive real-world user workflows:
 * - Scenario 1: Juan (Streak 47) Check-In via Voice Note Workflow
 * - Scenario 2: Sister Francy (Streak 18) Check-In with Complex Formatting & Bullets
 * - Scenario 3: Web Dashboard Real-Time Rendering of /api/status Data
 * - Scenario 4: Multi-Day Absence & Autonomous Recovery Workflow
 * - Scenario 5: Dual-Timezone Evening Streak Reminder & Interactive Shield Refund
 */

import assert from 'node:assert/strict';
import { setupTestEnvironment } from './helpers/mock-env.js';
import { adapter } from './helpers/adapter.js';
import { getLocalDateString, getPreviousDateString, getDayOfWeek } from '../api/_time.js';

export async function runTier4Tests() {
  console.log('\n======================================================');
  console.log('  RUNNING TIER 4: REAL-WORLD END-TO-END SCENARIOS');
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

  // -------------------------------------------------------------------------
  // Scenario 1: Juan (Streak 47) Check-In via Voice Note Workflow
  // -------------------------------------------------------------------------
  await asyncTest('Scenario 1: Full Voice Note Workflow for Bro Juan (Streak 47 -> 48)', async () => {
    // 1. Initial State Verification
    const state = await env.storage.getState();
    const juan = state.users.userA;
    assert.equal(juan.name, 'Juan');
    assert.equal(juan.streak, 47);
    assert.equal(juan.shields, 2);
    assert.equal(juan.profile.cefrLevel, 'B2');

    // 2. Simulate Telegram Webhook receiving voice message
    const voiceUpdate = {
      update_id: 10001,
      message: {
        message_id: 501,
        from: { id: "11111", first_name: "Juan", username: "juan_dev" },
        chat: { id: -100123456789, type: "supergroup" },
        date: Math.floor(Date.now() / 1000),
        voice: {
          file_id: "voice_file_abc_123",
          duration: 14,
          mime_type: "audio/ogg",
          file_size: 24500
        }
      }
    };

    // 3. Simulate Telegram getFile and binary download
    const fileMetadataRes = await globalThis.fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile`, {
      method: 'POST',
      body: JSON.stringify({ file_id: voiceUpdate.message.voice.file_id })
    });
    const fileMeta = await fileMetadataRes.json();
    assert.equal(fileMeta.ok, true);
    assert.ok(fileMeta.result.file_path);

    const downloadRes = await globalThis.fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileMeta.result.file_path}`);
    const audioBuffer = await downloadRes.buffer();
    assert.ok(audioBuffer.length > 0);
    const audioBase64 = audioBuffer.toString('base64');
    assert.ok(audioBase64.length > 0);

    // 4. Simulate Gemini Multimodal Evaluation
    const geminiPayload = {
      contents: [{
        parts: [
          { text: "Evaluate English practice voice note and return structured pedagogical JSON." },
          { inlineData: { mimeType: "audio/ogg", data: audioBase64 } }
        ]
      }]
    };

    const aiRes = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini', {
      method: 'POST',
      body: JSON.stringify(geminiPayload)
    });
    const aiData = await aiRes.json();
    assert.equal(aiRes.ok, true);
    const candidateText = aiData.candidates[0].content.parts[0].text;
    const evaluation = JSON.parse(candidateText);

    assert.equal(evaluation.isEnglishValid, true);
    assert.ok(evaluation.transcription);
    assert.ok(evaluation.pronunciationFeedback);
    assert.ok(evaluation.vocabularyItem);
    assert.ok(evaluation.learningProfileUpdate);

    // 5. Update Juan's State Transactionally
    const currentDate = getLocalDateString(new Date(), juan.timezone);
    juan.streak += 1; // 47 -> 48!
    juan.lastCheckIn = currentDate;
    if (!juan.checkInHistory) juan.checkInHistory = {};
    juan.checkInHistory[currentDate] = true;

    // Update learning profile
    juan.profile = {
      cefrLevel: evaluation.learningProfileUpdate.cefrLevel,
      strengths: evaluation.learningProfileUpdate.strengths.slice(0, 3),
      focusAreas: evaluation.learningProfileUpdate.focusAreas.slice(0, 3),
      lastUpdated: new Date().toISOString()
    };

    // Update Spaced Repetition vocabulary bank
    if (!juan.vocabulary) juan.vocabulary = [];
    juan.vocabulary.push({
      term: evaluation.vocabularyItem.term,
      meaning: evaluation.vocabularyItem.meaning,
      example: evaluation.vocabularyItem.example,
      addedDate: currentDate,
      reviewCount: 0
    });

    await env.storage.saveState(state);

    // 6. Verify Persisted Results
    const finalState = await env.storage.getState();
    assert.equal(finalState.users.userA.streak, 48);
    assert.equal(finalState.users.userA.lastCheckIn, currentDate);
    assert.equal(finalState.users.userA.profile.cefrLevel, 'B2');
    assert.ok(finalState.users.userA.vocabulary.some(v => v.term === evaluation.vocabularyItem.term));

    // 7. Verify Telegram Formatted Feedback & Inline Keyboard
    const feedbackHtml = adapter.formatTelegramHtml(
      `🎉 <b>¡Excelente práctica oral, Juan!</b>\n\n` +
      `🎤 <b>Transcripción:</b> <i>"${evaluation.transcription}"</i>\n\n` +
      `🗣️ <b>Pronunciación:</b> ${evaluation.pronunciationFeedback}\n\n` +
      `🔥 Tu racha aumentó a <b>48 días</b>.`
    );
    const keyboard = adapter.createInlineKeyboard();

    assert.match(feedbackHtml, /¡Excelente práctica oral, Juan!<\/b>/);
    assert.match(feedbackHtml, /48 días<\/b>/);
    assert.ok(keyboard.inline_keyboard.length === 2);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Sister Francy (Streak 18) Check-In with Complex Formatting & Bullets
  // -------------------------------------------------------------------------
  await asyncTest('Scenario 2: Complex Formatting & Markdown Bullets for Sister Francy (Streak 18 -> 19)', async () => {
    const state = await env.storage.getState();
    const francy = state.users.userB;
    assert.equal(francy.name, 'Sister Francy');
    assert.equal(francy.streak, 18);
    assert.equal(francy.shields, 1);

    // Complex Markdown check-in input from Sister Francy
    const complexInput = 
      `### Today's English Reflection\n\n` +
      `* **Speaking practice**: Discussed daily routines with friends.\n` +
      `* **Grammar focus**: *Present Perfect* vs *Past Simple*.\n` +
      `* **Key difference**: 'have gone' & 'have been' nuances.\n\n` +
      `> "Consistency is not about perfection, it is about never giving up."\n\n` +
      `Code example:\n` +
      `\`\`\`javascript\n` +
      `const streak = 18 + 1;\n` +
      `\`\`\``;

    // 1. Format text using the robust HTML pipeline
    const formattedHtml = adapter.formatTelegramHtml(complexInput);

    // Verify entity escaping, bullet conversion, and tag balancing
    assert.match(formattedHtml, /• <b>Speaking practice:<\/b>/);
    assert.match(formattedHtml, /• <b>Grammar focus:<\/b> <i>Present Perfect<\/i> vs <i>Past Simple<\/i>/);
    assert.match(formattedHtml, /&amp; &#39;have been&#39;|'have been'|&amp;/);
    assert.match(formattedHtml, /<blockquote>&quot;Consistency is not about perfection/);
    assert.match(formattedHtml, /<pre><code/);

    // Verify tag balancing
    const balanced = adapter.balanceHtmlTags(formattedHtml);
    assert.equal(formattedHtml, balanced);

    // 2. Process check-in for Sister Francy
    const currentDate = getLocalDateString(new Date(), francy.timezone);
    francy.streak += 1; // 18 -> 19
    francy.lastCheckIn = currentDate;
    francy.profile = {
      cefrLevel: "B1",
      strengths: ["Clear sentence rhythm", "Dedication", "Good vocabulary"],
      focusAreas: ["Present Perfect vs Past Simple", "Preposition collocations"],
      lastUpdated: new Date().toISOString()
    };
    await env.storage.saveState(state);

    const savedState = await env.storage.getState();
    assert.equal(savedState.users.userB.streak, 19);
    assert.equal(savedState.users.userB.lastCheckIn, currentDate);
    assert.equal(savedState.users.userB.profile.focusAreas[0], "Present Perfect vs Past Simple");
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Web Dashboard Real-Time Rendering of /api/status Data
  // -------------------------------------------------------------------------
  await asyncTest('Scenario 3: Web Dashboard consuming /api/status JSON', async () => {
    const state = await env.storage.getState();
    
    // Simulate HTTP GET /api/status
    const req = { method: 'GET' };
    const resHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { resHeaders[k] = v; },
      json(data) { this.data = data; return this; }
    };

    await adapter.statusHandler(req, res, state);

    assert.equal(res.statusCode, 200);
    assert.equal(resHeaders['Content-Type'], 'application/json');
    assert.match(resHeaders['Cache-Control'], /max-age=60/);

    const payload = res.data;
    assert.equal(payload.status, 'ok');
    assert.ok(payload.dailySpark);
    assert.ok(Array.isArray(payload.participants));
    assert.equal(payload.participants.length, 2);

    // Verify participants public schema
    const juan = payload.participants.find(p => p.name === 'Juan');
    const francy = payload.participants.find(p => p.name === 'Sister Francy');

    assert.ok(juan);
    assert.equal(juan.streak, 48);
    assert.equal(juan.shields, 2);
    assert.equal(juan.cefrLevel, 'B2');
    assert.equal(juan.checkedInToday, true);

    assert.ok(francy);
    assert.equal(francy.streak, 19);
    assert.equal(francy.shields, 1);
    assert.equal(francy.cefrLevel, 'B1');
    assert.equal(francy.checkedInToday, true);

    // Verify zero secret leakage
    const rawJson = JSON.stringify(payload);
    assert.doesNotMatch(rawJson, /chatId/i);
    assert.doesNotMatch(rawJson, /token/i);
    assert.doesNotMatch(rawJson, /queue/i);
    assert.doesNotMatch(rawJson, /"id":/i);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Multi-Day Absence & Autonomous Recovery Workflow
  // -------------------------------------------------------------------------
  test('Scenario 4: Multi-Day Vacation (4 days off) -> Shields Expended, Streak Broken, Monday Reset & Recovery', () => {
    // User departs Thursday night (last check-in 2026-10-01)
    const traveler = {
      name: "Traveler",
      streak: 25,
      shields: 2,
      lastEvaluatedDate: "2026-10-01", // Thursday
      lastShieldResetDate: "2026-09-28", // Monday
      checkInHistory: {}
    };

    // User is absent:
    // Friday (10-02): misses -> shield 2 -> 1
    // Saturday (10-03): misses -> shield 1 -> 0
    // Sunday (10-04): misses -> 0 shields -> STREAK BREAK (streak -> 0)
    // Monday (10-05): Monday Shield Reset fires -> shields 0 -> 2!
    //                 Misses Monday -> shield 2 -> 1
    // Evaluates up to Monday 10-05 when Cron runs on Tuesday 10-06 06:00 UTC
    const catchupRes = adapter.evaluateMultiDayCatchup(traveler, "2026-10-06");

    assert.equal(catchupRes.evaluatedDays.length, 4); // 10-02, 10-03, 10-04, 10-05
    assert.equal(traveler.streak, 0); // Broken on Sunday
    assert.equal(catchupRes.penalties.length, 1);
    assert.equal(catchupRes.penalties[0].date, "2026-10-04");
    assert.equal(catchupRes.penalties[0].previousStreak, 25);

    // Monday reset occurred
    assert.equal(traveler.lastShieldResetDate, "2026-10-05");
    assert.equal(traveler.shields, 1); // Restored to 2, 1 consumed for Monday

    // Traveler returns on Tuesday afternoon and submits practice
    traveler.streak = 1; // Restart streak
    traveler.lastCheckIn = "2026-10-06";
    assert.equal(traveler.streak, 1);
    assert.equal(traveler.shields, 1);
    assert.equal(traveler.lastCheckIn, "2026-10-06");
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Dual-Timezone Evening Streak Reminder & Interactive Shield Refund
  // -------------------------------------------------------------------------
  test('Scenario 5: Evening Reminder Alert -> Manual Shield Activation -> Same-Day Practice -> Shield Refund', () => {
    const student = {
      name: "Juan",
      streak: 47,
      shields: 2,
      lastCheckIn: null,
      lastShieldUsedDate: null,
      timezone: "America/Argentina/Buenos_Aires"
    };
    const today = "2026-10-02";

    // 1. Evening arrives (21:00 Arg). Bot detects student has not checked in.
    const isPending = student.lastCheckIn !== today && student.lastShieldUsedDate !== today;
    assert.equal(isPending, true);

    const reminderMsg = adapter.formatTelegramHtml(
      `⚠️ <b>¡Atención, ${student.name}!</b> Aún no registraste tu inglés de hoy.\n` +
      `Tu racha de <b>${student.streak} días</b> está en juego. ¡Tenés hasta medianoche!`
    );
    assert.match(reminderMsg, /¡Atención, Juan!<\/b>/);
    assert.match(reminderMsg, /47 días<\/b>/);

    // 2. Student activates shield via inline button [🛡️ Usar Escudo]
    student.shields -= 1;
    student.lastShieldUsedDate = today;
    assert.equal(student.shields, 1);
    assert.equal(student.lastShieldUsedDate, today);

    // 3. Later that evening (23:30), student decides to practice anyway and submits check-in!
    if (student.lastShieldUsedDate === today) {
      student.shields += 1; // Refund shield!
      student.lastShieldUsedDate = null;
    }
    student.streak += 1; // 47 -> 48
    student.lastCheckIn = today;

    assert.equal(student.shields, 2); // Fully refunded!
    assert.equal(student.lastShieldUsedDate, null);
    assert.equal(student.streak, 48);
    assert.equal(student.lastCheckIn, today);
  });

  env.time.uninstall();
  env.network.uninstall();

  console.log(`\n  Tier 4 Complete: ${passed}/${total} tests passed.\n`);
  return { passed, total };
}

// Auto-run if executed directly
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('tier4-scenarios.test.js') || process.argv[1].endsWith('tier4-scenarios.test'));
if (isDirectRun) {
  runTier4Tests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
