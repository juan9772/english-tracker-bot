// test/tier5-adversarial.test.js
/**
 * Tier 5: Adversarial Coverage Challenger Test Suite
 * 
 * Performs white-box adversarial stress testing across 5 critical domains:
 * 1. HTML Parser & Tag Balancer (deep nesting, crossed tags, extreme lengths, entities, boundaries)
 * 2. Cron Catchup & Timezones (30-day/365-day jumps, year-end, Monday collisions, missing properties)
 * 3. Dynamic Scalability & Merge Safeguards (10+ users, special chars, unforced streak protection)
 * 4. Multimodal & Gemini Robustness (malformed JSON, code blocks, extra fields, audio boundaries)
 * 5. Public Status API & Security Fuzzing (405 methods, query fuzzing, credential zero-leakage)
 */

import assert from 'node:assert/strict';
import { setupTestEnvironment } from './helpers/mock-env.js';
import { adapter } from './helpers/adapter.js';
import {
  parseTelegramTag,
  escapeTelegramHtml,
  balanceHtmlTags,
  formatTelegramHtml,
  chunkTelegramHtml,
  createInlineKeyboard,
  SUPPORTED_TAGS
} from '../api/_telegram.js';
import { evaluateMultiDayCatchup, getNextDateString } from '../api/cron.js';
import {
  getState,
  saveState,
  setMockState,
  findUserKey,
  getInitialState
} from '../api/_db.js';
import { callGemini, callGeminiAudio } from '../api/_gemini.js';
import statusHandler from '../api/status.js';
import webhookHandler from '../api/webhook.js';
import { getLocalDateString, getPreviousDateString, getDayOfWeek } from '../api/_time.js';

function createMockReqRes(method = 'GET', query = {}, headers = {}, body = null) {
  const req = { method, query, headers, body, url: '/api/status' };
  const headersSent = {};
  let responseData = null;
  const res = {
    statusCode: 200,
    setHeader(k, v) { headersSent[k.toLowerCase()] = v; },
    getHeader(k) { return headersSent[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(data) { responseData = data; return this; },
    send(data) { responseData = data; return this; },
    end(data) {
      if (data && responseData === null) {
        try { responseData = JSON.parse(data); } catch { responseData = data; }
      }
      return this;
    }
  };
  return {
    req,
    res,
    getStatusCode: () => res.statusCode,
    getResponseData: () => responseData,
    getHeaders: () => headersSent
  };
}

export async function runTier5Tests() {
  console.log('\n=============================================================');
  console.log('  RUNNING TIER 5: ADVERSARIAL STRESS TESTING (White-Box)');
  console.log('=============================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      // console.log(`  ✓ ${name}`);
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
      // console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  const env = setupTestEnvironment();

  // =========================================================================
  // DOMAIN 1: HTML PARSER & TAG BALANCER ADVERSARIAL STRESS
  // =========================================================================
  console.log('  [Domain 1] HTML Parser & Tag Balancer Stress...');

  test('T5.1.1: Deeply nested tags (10 levels) are preserved and balanced', () => {
    const input = '<b><i><u><s><code><span><tg-spoiler><blockquote><b><i>Deep</i></b></blockquote></tg-spoiler></span></code></s></u></i></b>';
    const output = formatTelegramHtml(input);
    assert.ok(output.length > 0);
    // Ensure all opening tags match closing tags count
    for (const tag of ['b', 'i', 'u', 's', 'code', 'blockquote']) {
      const openCount = (output.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
      const closeCount = (output.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(openCount, closeCount, `Mismatched counts for tag <${tag}>`);
    }
  });

  test('T5.1.2: Deep nesting (50+ levels of tags) does not cause stack overflow', () => {
    let input = '';
    const levels = 50;
    for (let i = 0; i < levels; i++) input += '<b><i>';
    input += 'Stress Test Content';
    for (let i = 0; i < levels; i++) input += '</i></b>';

    const output = balanceHtmlTags(input);
    assert.ok(output.includes('Stress Test Content'));
    const bOpen = (output.match(/<b>/g) || []).length;
    const bClose = (output.match(/<\/b>/g) || []).length;
    assert.equal(bOpen, bClose);
  });

  test('T5.1.3: Deeply unclosed tags (25 levels) auto-closed in strict reverse LIFO order', () => {
    const tags = ['b', 'i', 'u', 's', 'code', 'blockquote'];
    let unclosed = '';
    for (let i = 0; i < 24; i++) {
      unclosed += `<${tags[i % tags.length]}>`;
    }
    unclosed += 'Unclosed payload';

    const balanced = balanceHtmlTags(unclosed);
    assert.ok(balanced.startsWith('<b>'));
    // Verify each opened tag has a corresponding closing tag
    for (const tag of tags) {
      const openMatches = (balanced.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
      const closeMatches = (balanced.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      assert.equal(openMatches, closeMatches, `Tag <${tag}> count mismatch in LIFO balance`);
    }
    // Verify string ends with closing tags
    assert.match(balanced, /<\/[a-z]+>$/);
  });

  test('T5.1.4: Inverted / crossed closing tags <b><i>text</b></i> unwinds properly', () => {
    const input = '<b><i>Inverted tags</b></i>';
    const output = balanceHtmlTags(input);
    // When </b> is encountered while <i> is open, <i> must close before <b> closes
    assert.ok(output.includes('</i></b>') || output.includes('</b>'));
    assert.doesNotMatch(output, /<\/i><\/i>/);
  });

  test('T5.1.5: Complex criss-crossed tags unwind and balance without orphan closers', () => {
    const input = '<b>1 <i>2 <u>3 <code>4</b> delta</i> echo</u>';
    const output = balanceHtmlTags(input);
    assert.ok(!output.includes('</b> delta</i> echo</u>'));
    // Check all open tags are balanced
    const bOpen = (output.match(/<b>/g) || []).length;
    const bClose = (output.match(/<\/b>/g) || []).length;
    assert.equal(bOpen, bClose);
  });

  test('T5.1.6: Orphan closing tags at start, middle, and end are discarded', () => {
    const input = '</b></i>Hello </code>world</pre>!</blockquote>';
    const output = balanceHtmlTags(input);
    assert.equal(output.trim(), 'Hello world!');
    assert.doesNotMatch(output, /<\//);
  });

  test('T5.1.7: Extreme text lengths (5,000 chars) chunked strictly <= 4000', () => {
    const longText = 'English habit building sentence. '.repeat(155); // ~5115 chars
    const chunks = chunkTelegramHtml(longText, 4000);
    assert.ok(chunks.length >= 2);
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= 4000, `Chunk ${i} exceeded 4000 chars (was ${chunks[i].length})`);
      assert.ok(chunks[i].length > 0);
    }
  });

  test('T5.1.8: Extreme text lengths (15,000 chars) partitioned without dropping text', () => {
    const paragraph = 'Practice speaking every single day without interruption.\n\n';
    const hugeText = paragraph.repeat(260); // ~15,000 chars
    const chunks = chunkTelegramHtml(hugeText, 4000);
    assert.ok(chunks.length >= 4);
    for (const c of chunks) {
      assert.ok(c.length <= 4000);
    }
    // Check that first sentence and last sentence are preserved
    assert.ok(chunks[0].includes('Practice speaking'));
    assert.ok(chunks[chunks.length - 1].includes('interruption.'));
  });

  test('T5.1.9: Unclosed <b> spanning chunk boundary closes in chunk 1 and reopens in chunk 2', () => {
    const prefix = '<b>';
    const filler = 'Word '.repeat(850); // ~4250 chars
    const input = prefix + filler + '</b>';
    const chunks = chunkTelegramHtml(input, 4000);

    assert.ok(chunks.length >= 2);
    // Chunk 1 must end with </b>
    assert.ok(chunks[0].endsWith('</b>'), 'Chunk 1 must auto-close the active <b> tag');
    // Chunk 2 must start with <b>
    assert.ok(chunks[1].startsWith('<b>'), 'Chunk 2 must reopen the active <b> tag');
  });

  test('T5.1.10: Multiple active tags (<blockquote><b><i>) across chunk boundary balance and reopen', () => {
    const prefix = '<blockquote><b><i>';
    const filler = 'Learning English fluency through immersion. '.repeat(100); // ~4400 chars
    const input = prefix + filler + '</i></b></blockquote>';
    const chunks = chunkTelegramHtml(input, 4000);

    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].endsWith('</i></b></blockquote>'));
    assert.ok(chunks[1].startsWith('<blockquote><b><i>'));
  });

  test('T5.1.11: Ampersands in URLs (<a href="...">) vs plain text (&)', () => {
    const input = 'Check out <a href="https://example.com/search?q=english&lang=en&ref=bot">Search & Find</a> for bread & butter';
    const output = formatTelegramHtml(input);
    // URL href must retain valid ampersands or entity
    assert.ok(output.includes('href="https://example.com/search?q=english&lang=en&ref=bot"'));
    // Plain text outside tags must be escaped
    assert.ok(output.includes('bread &amp; butter'));
    assert.ok(output.includes('Search &amp; Find'));
  });

  test('T5.1.12: Pre-escaped entities (&amp;, &lt;, &gt;, &quot;, &#123;) not double-escaped', () => {
    const input = 'Formula: &amp; &lt; &gt; &quot; &#123; and raw & < > "';
    const output = formatTelegramHtml(input);
    assert.doesNotMatch(output, /&amp;amp;/);
    assert.doesNotMatch(output, /&amp;lt;/);
    assert.doesNotMatch(output, /&amp;gt;/);
    assert.doesNotMatch(output, /&amp;quot;/);
    assert.doesNotMatch(output, /&amp;#123;/);
    assert.ok(output.includes('&amp; &lt; &gt; &quot; &#123;'));
  });

  test('T5.1.13: Malicious / disallowed tags (<script>, <iframe>, <object>) escaped safely', () => {
    const input = 'Notice: <script>alert("xss")</script> and <iframe src="evil.com"></iframe>';
    const output = formatTelegramHtml(input);
    assert.ok(output.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
    assert.ok(output.includes('&lt;iframe src="evil.com"&gt;&lt;/iframe&gt;') || output.includes('&lt;iframe src=&quot;evil.com&quot;&gt;&lt;/iframe&gt;'));
    assert.doesNotMatch(output, /<script>/i);
    assert.doesNotMatch(output, /<iframe>/i);
  });

  test('T5.1.14: Disallowed attributes stripped from whitelist tags (<b onclick=...>)', () => {
    const tag = parseTelegramTag('<b onclick="malicious()" style="color:red">');
    // For <b>, parseTelegramTag rejects tags with disallowed rawAttrs
    assert.equal(tag, null);
    // When run through formatTelegramHtml, it is escaped safely
    const output = formatTelegramHtml('<b onclick="malicious()">Bold</b>');
    assert.ok(output.includes('&lt;b onclick="malicious()"&gt;Bold') || output.includes('&lt;b onclick=&quot;malicious()&quot;&gt;Bold'));
  });

  test('T5.1.15: Valid Telegram tag attributes (code class, a href, tg-emoji emoji-id) preserved', () => {
    const codeTag = parseTelegramTag('<code class="language-javascript">');
    assert.notEqual(codeTag, null);
    assert.equal(codeTag.cleanTag, '<code class="language-javascript">');

    const aTag = parseTelegramTag('<a href="https://t.me/studygroup">');
    assert.notEqual(aTag, null);
    assert.equal(aTag.cleanTag, '<a href="https://t.me/studygroup">');

    const emojiTag = parseTelegramTag('<tg-emoji emoji-id="5368324170671202286">');
    assert.notEqual(emojiTag, null);
    assert.equal(emojiTag.cleanTag, '<tg-emoji emoji-id="5368324170671202286">');
  });

  test('T5.1.16: Multibyte surrogate pairs (🚀, 🧠, 🛡️, 🇦🇷) chunked cleanly without splitting code units', () => {
    const emoji = '🔥'; // Surrogate pair \uD83D\uDD25 (2 code units)
    const longEmojiString = (emoji + ' English ').repeat(450); // > 4000 code units
    const chunks = chunkTelegramHtml(longEmojiString, 4000);
    assert.ok(chunks.length >= 2);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 4000);
      // Ensure no lone high surrogate at the end: 0xD800 - 0xDBFF
      const lastCharCode = chunk.charCodeAt(chunk.length - 1);
      assert.ok(lastCharCode < 0xD800 || lastCharCode > 0xDBFF, 'Lone surrogate detected at end of chunk');
      // Ensure no lone low surrogate at the start: 0xDC00 - 0xDFFF
      const firstCharCode = chunk.charCodeAt(0);
      assert.ok(firstCharCode < 0xDC00 || firstCharCode > 0xDFFF, 'Lone low surrogate detected at start of chunk');
    }
  });

  test('T5.1.17: Broken angle brackets ("3 < 5 and 10 > 2", "<<>>") are strictly escaped', () => {
    const input = 'Compare: 3 < 5 and 10 > 2, also <<nested>> brackets';
    const output = formatTelegramHtml(input);
    assert.ok(output.includes('3 &lt; 5 and 10 &gt; 2'));
    assert.ok(output.includes('&lt;&lt;nested&gt;&gt;'));
    assert.doesNotMatch(output, /(?<![a-zA-Z0-9])<(?![a-zA-Z\/])/);
  });

  test('T5.1.18: Markdown bullet list (* item) disambiguated from italics (*italic*)', () => {
    const input = '* First item\n* Second item\n* Third item\n\nNow *this is italic* text.';
    const output = formatTelegramHtml(input);
    assert.ok(output.includes('• First item'));
    assert.ok(output.includes('• Second item'));
    assert.ok(output.includes('• Third item'));
    assert.ok(output.includes('<i>this is italic</i>'));
    assert.doesNotMatch(output, /<i>\s*First item/);
  });

  test('T5.1.19: Unclosed tag at exact chunk boundary (char 3998) budgets closing tag <= maxLen', () => {
    // Construct text with exactly 3995 chars, then <b>tag and more chars
    const base = 'A'.repeat(3990) + ' ';
    const input = base + '<b>Important word that crosses the boundary</b>';
    const chunks = chunkTelegramHtml(input, 4000);
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= 4000, `Chunk ${i} length ${chunks[i].length} exceeds 4000`);
    }
  });

  test('T5.1.20: Null, undefined, empty string, and non-string inputs handle gracefully', () => {
    assert.equal(formatTelegramHtml(null), '');
    assert.equal(formatTelegramHtml(undefined), '');
    assert.equal(formatTelegramHtml(''), '');
    assert.equal(balanceHtmlTags(null), '');
    assert.deepEqual(chunkTelegramHtml(null), []);
    assert.deepEqual(chunkTelegramHtml(''), []);
  });

  test('T5.1.21: Uppercase HTML tags (<B><I>TEXT</I></B>) normalized in tag balancer', () => {
    const input = '<B><I>UPPERCASE TEXT</I></B>';
    const output = balanceHtmlTags(input);
    assert.ok(output.includes('<b><i>UPPERCASE TEXT</i></b>'));
  });

  test('T5.1.22: Void tags (<br>, <br/>, <hr>) converted to newlines without breaking tag balancer stack', () => {
    const input = 'Line 1<br>Line 2<br/>Line 3<hr><b>Line 4</b>';
    const output = formatTelegramHtml(input);
    assert.ok(output.includes('Line 1\nLine 2\nLine 3\n\n<b>Line 4</b>') || output.includes('Line 1\nLine 2\nLine 3\n<b>Line 4</b>'));
  });

  // =========================================================================
  // DOMAIN 2: CRON CATCHUP & TIMEZONES ADVERSARIAL STRESS
  // =========================================================================
  console.log('  [Domain 2] Cron Catchup & Timezone Stress...');

  test('T5.2.1: 30-Day inactivity jump (2026-09-01 to 2026-10-02) evaluates all 30 days', () => {
    const user = {
      name: "DormantUser",
      streak: 50,
      shields: 2,
      lastEvaluatedDate: "2026-09-01",
      lastShieldResetDate: "2026-08-31",
      checkInHistory: {}
    };
    const res = evaluateMultiDayCatchup(user, "2026-10-02");
    // Yesterday is 2026-10-01. Days: Sept 2 to Oct 1 = 30 days
    assert.equal(res.evaluatedDays.length, 30);
    assert.equal(user.lastEvaluatedDate, "2026-10-01");
    // Streak must have collapsed to 0
    assert.equal(user.streak, 0);
    // At least 1 penalty assessed
    assert.ok(res.penalties.length >= 1);
  });

  test('T5.2.2: 30-Day catchup resets shields on every intermediate Monday', () => {
    const user = {
      name: "WeeklyResetUser",
      streak: 10,
      shields: 0,
      lastEvaluatedDate: "2026-09-01",
      lastShieldResetDate: "2026-08-31",
      checkInHistory: {}
    };
    const res = evaluateMultiDayCatchup(user, "2026-10-02");
    // Sept 2026 Mondays: Sept 7, Sept 14, Sept 21, Sept 28
    // On each Monday, shields were reset to 2, then consumed for missed days.
    // Shields used across the month should be multiple
    assert.ok(res.shieldsUsed >= 4, `Shields used should be >= 4, got ${res.shieldsUsed}`);
  });

  test('T5.2.3: 365-Day inactivity jump (2025-10-01 to 2026-10-02) evaluates all 365 days across year boundary', () => {
    const user = {
      name: "CentennialAbsence",
      streak: 100,
      shields: 2,
      lastEvaluatedDate: "2025-10-01",
      lastShieldResetDate: "2025-09-29",
      checkInHistory: {}
    };
    const startTime = Date.now();
    const res = evaluateMultiDayCatchup(user, "2026-10-02");
    const duration = Date.now() - startTime;

    assert.equal(user.lastEvaluatedDate, "2026-10-01");
    assert.equal(res.evaluatedDays.length, 365);
    assert.equal(user.streak, 0);
    // 365 iterations in JS must finish in under 100ms
    assert.ok(duration < 200, `365-day catchup took too long: ${duration}ms`);
  });

  test('T5.2.4: Year-end transition (2025-12-30 to 2026-01-02) seamlessly traverses Dec 31 and Jan 1', () => {
    const user = {
      name: "NewYearUser",
      streak: 20,
      shields: 2,
      lastEvaluatedDate: "2025-12-30",
      lastShieldResetDate: "2025-12-29",
      checkInHistory: {
        "2025-12-31": true,
        "2026-01-01": true
      }
    };
    const res = evaluateMultiDayCatchup(user, "2026-01-02");
    assert.deepEqual(res.evaluatedDays, ["2025-12-31", "2026-01-01"]);
    assert.equal(user.lastEvaluatedDate, "2026-01-01");
    assert.equal(user.streak, 20); // Streak preserved because user checked in both days
    assert.equal(res.shieldsUsed, 0);
    assert.equal(res.penalties.length, 0);
  });

  test('T5.2.5: Leap-year transition (2024-02-27 to 2024-03-02) correctly advances Feb 28, 29, March 1', () => {
    const user = {
      name: "LeapUser",
      streak: 15,
      shields: 2,
      lastEvaluatedDate: "2024-02-27",
      lastShieldResetDate: "2024-02-26",
      checkInHistory: {
        "2024-02-28": true,
        "2024-02-29": true,
        "2024-03-01": true
      }
    };
    const res = evaluateMultiDayCatchup(user, "2024-03-02");
    assert.deepEqual(res.evaluatedDays, ["2024-02-28", "2024-02-29", "2024-03-01"]);
    assert.equal(user.lastEvaluatedDate, "2024-03-01");
    assert.equal(user.streak, 15);
  });

  test('T5.2.6: Monday reset collision: missing Monday resets shields to 2 first, consumes 1, keeps streak', () => {
    // 2026-10-05 is Monday. 2026-10-04 is Sunday.
    // User has 0 shields on Sunday night.
    const user = {
      name: "MondayHero",
      streak: 30,
      shields: 0,
      lastEvaluatedDate: "2026-10-04",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {} // Missed Monday 2026-10-05
    };
    // Evaluate on Tuesday 2026-10-06 (previousDateStr is Monday 2026-10-05)
    const res = evaluateMultiDayCatchup(user, "2026-10-06");
    assert.deepEqual(res.evaluatedDays, ["2026-10-05"]);
    // On Monday, shields reset to 2, then 1 shield consumed for missed day
    assert.equal(user.shields, 1);
    assert.equal(user.streak, 30); // Streak preserved by Monday reset shield!
    assert.equal(res.shieldsUsed, 1);
    assert.equal(res.penalties.length, 0);
  });

  test('T5.2.7: Dual timezone sync at 06:00 UTC (Argentina UTC-3 & Mexico UTC-6 both have completed yesterday)', () => {
    const utcDate = new Date("2026-10-02T06:00:00.000Z");
    const argDateStr = getLocalDateString(utcDate, "America/Argentina/Buenos_Aires");
    const mexDateStr = getLocalDateString(utcDate, "America/Mexico_City");

    assert.equal(argDateStr, "2026-10-02");
    assert.equal(mexDateStr, "2026-10-02");

    // Both previous dates are 2026-10-01
    const prevArg = getPreviousDateString(argDateStr);
    const prevMex = getPreviousDateString(mexDateStr);
    assert.equal(prevArg, "2026-10-01");
    assert.equal(prevMex, "2026-10-01");
  });

  test('T5.2.8: Zero shields boundary: missing day immediately collapses streak and records penalty', () => {
    const user = {
      name: "NoShieldsUser",
      streak: 25,
      shields: 0,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {}
    };
    // Current date is 2026-10-03 (yesterday is 2026-10-02, a Friday, not Monday)
    const res = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(user.streak, 0);
    assert.equal(user.shields, 0);
    assert.equal(res.penalties.length, 1);
    assert.equal(res.penalties[0].previousStreak, 25);
  });

  test('T5.2.9: Negative shield protection: corrupted shields (-3) does not grant shields or underflow', () => {
    const user = {
      name: "NegativeShields",
      streak: 10,
      shields: -3,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {}
    };
    const res = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(user.streak, 0);
    assert.ok(user.shields <= 0);
    assert.equal(res.shieldsUsed, 0);
  });

  test('T5.2.10: User with missing/null properties handles catchup without unhandled TypeError', () => {
    const user = {
      name: "BareUser",
      lastEvaluatedDate: "2026-10-01"
      // missing streak, shields, checkInHistory, lastShieldResetDate
    };
    const res = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(user.lastEvaluatedDate, "2026-10-02");
    assert.equal(user.streak, 0);
  });

  test('T5.2.11: Idempotent catchup: running twice on same day produces 0 additional evaluations', () => {
    const user = {
      name: "IdempotentUser",
      streak: 15,
      shields: 2,
      lastEvaluatedDate: "2026-10-01",
      checkInHistory: { "2026-10-02": true }
    };
    const res1 = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(res1.evaluatedDays.length, 1);
    assert.equal(user.lastEvaluatedDate, "2026-10-02");

    const res2 = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(res2.evaluatedDays.length, 0);
    assert.equal(res2.penalties.length, 0);
    assert.equal(res2.shieldsUsed, 0);
  });

  test('T5.2.12: Clock desync / future lastEvaluatedDate terminates immediately with 0 days evaluated', () => {
    const user = {
      name: "FutureUser",
      streak: 20,
      shields: 2,
      lastEvaluatedDate: "2026-10-10",
      checkInHistory: {}
    };
    // Current date is 2026-10-03 (yesterday is 2026-10-02)
    const res = evaluateMultiDayCatchup(user, "2026-10-03");
    assert.equal(res.evaluatedDays.length, 0);
    assert.equal(user.streak, 20);
  });

  test('T5.2.13: Intermixed check-ins and shield usages over a 5-day catchup sequence', () => {
    // 2026-10-06 is Tuesday. Monday was 2026-10-05 (shields reset to 2).
    // Days evaluated: 2026-10-01 (Thu), 2026-10-02 (Fri), 2026-10-03 (Sat), 2026-10-04 (Sun), 2026-10-05 (Mon)
    const user = {
      name: "IntermixedUser",
      streak: 10,
      shields: 2,
      lastEvaluatedDate: "2026-09-30",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {
        "2026-10-01": true,
        "2026-10-03": true
      }
    };
    const res = evaluateMultiDayCatchup(user, "2026-10-06");
    assert.equal(res.evaluatedDays.length, 5);
    assert.equal(user.streak, 10);
    assert.equal(user.shields, 1);
    assert.equal(res.shieldsUsed, 3);
    assert.equal(res.penalties.length, 0);
  });

  // =========================================================================
  // DOMAIN 3: DYNAMIC SCALABILITY & MERGE SAFEGUARDS
  // =========================================================================
  console.log('  [Domain 3] Dynamic Scalability & Merge Safeguards...');

  test('T5.3.1: Concurrent registration of 15 dynamic users retains all users without dropping', async () => {
    const state = getInitialState();
    state.users.userA.streak = 47;
    state.users.userB.streak = 18;

    for (let i = 1; i <= 15; i++) {
      const msg = {
        from: {
          id: 1000 + i,
          first_name: `Participant_${i}`,
          last_name: `Tester`,
          username: `user_${i}_official`,
          is_bot: false
        }
      };
      const key = findUserKey(state, msg);
      assert.ok(key);
      assert.ok(state.users[key]);
      assert.equal(state.users[key].name, `Participant_${i} Tester`);
    }

    assert.equal(Object.keys(state.users).length, 17); // userA, userB + 15 users
    assert.equal(state.users.userA.streak, 47);
    assert.equal(state.users.userB.streak, 18);
  });

  test('T5.3.2: Special characters and symbols in usernames (@Juan_Dev-2026.Official) resolve correctly', () => {
    const state = getInitialState();
    const dynamicKey = "998877";
    state.users[dynamicKey] = {
      id: "998877",
      username: "Juan_Dev-2026.Official",
      name: "Juan Complex",
      timezone: "America/Argentina/Buenos_Aires",
      streak: 5,
      shields: 2
    };

    // Test with leading @
    const msgWithAt = { from: { id: 12345, username: "@Juan_Dev-2026.Official" } };
    assert.equal(findUserKey(state, msgWithAt), dynamicKey);

    // Test with lowercase without @
    const msgLower = { from: { id: 12345, username: "juan_dev-2026.official" } };
    assert.equal(findUserKey(state, msgLower), dynamicKey);

    // Test with uppercase
    const msgUpper = { from: { id: 12345, username: "JUAN_DEV-2026.OFFICIAL" } };
    assert.equal(findUserKey(state, msgUpper), dynamicKey);
  });

  test('T5.3.3: International and unicode user display names (María José 🇦🇷, François) preserved', async () => {
    const state = getInitialState();
    const msg = {
      from: {
        id: 777666,
        first_name: "María José",
        last_name: "🇦🇷",
        username: "mariajose_arg",
        is_bot: false
      }
    };
    const key = findUserKey(state, msg);
    assert.equal(state.users[key].name, "María José 🇦🇷");
  });

  test('T5.3.4: Permanent preservation: userA (streak 47) and userB (streak 18) preserved if omitted from save', async () => {
    setMockState(null);
    const initial = getInitialState();
    initial.users.userA.streak = 47;
    initial.users.userA.id = "11111";
    initial.users.userB.streak = 18;
    initial.users.userB.id = "22222";
    await saveState(initial);

    // Adversarial save: incoming state has EMPTY users object
    const maliciousIncoming = { users: {} };
    await saveState(maliciousIncoming);

    const reloaded = await getState();
    assert.ok(reloaded.users.userA, 'userA was wiped by empty state save!');
    assert.ok(reloaded.users.userB, 'userB was wiped by empty state save!');
    assert.equal(reloaded.users.userA.streak, 47);
    assert.equal(reloaded.users.userB.streak, 18);
  });

  test('T5.3.5: Rejection of unforced streak decrease (userA 47 -> 0 prevented without forceReset)', async () => {
    setMockState(null);
    const initial = getInitialState();
    initial.users.userA.streak = 47;
    await saveState(initial);

    // Adversarial save: try to set userA streak to 0 without forceReset
    const compromised = await getState();
    compromised.users.userA.streak = 0;
    compromised.forceReset = false;
    await saveState(compromised);

    const reloaded = await getState();
    assert.equal(reloaded.users.userA.streak, 47, 'Safeguard failed: streak decreased without forceReset!');
  });

  test('T5.3.6: Legitimate streak penalty permitted when state.forceReset = true', async () => {
    setMockState(null);
    const initial = getInitialState();
    initial.users.userA.streak = 47;
    await saveState(initial);

    // Legitimate cron penalty with forceReset = true
    const legitimate = await getState();
    legitimate.users.userA.streak = 0;
    legitimate.forceReset = true;
    await saveState(legitimate);

    const reloaded = await getState();
    assert.equal(reloaded.users.userA.streak, 0, 'forceReset=true failed to permit valid penalty!');
  });

  test('T5.3.7: Bot messages (from.is_bot = true) rejected from dynamic registration', () => {
    const state = getInitialState();
    const botMsg = {
      from: {
        id: 999999,
        first_name: "SpamBot",
        username: "spam_bot",
        is_bot: true
      }
    };
    const key = findUserKey(state, botMsg);
    assert.equal(key, null, 'Bot was incorrectly registered as participant!');
    assert.equal(state.users["999999"], undefined);
  });

  test('T5.3.8: Merge safeguard preserves user profile and vocabulary bank when incoming state has partial objects', async () => {
    setMockState(null);
    const initial = getInitialState();
    initial.users.userA.profile = {
      cefrLevel: 'B2',
      strengths: ['Complex idioms', 'Fluid speech'],
      focusAreas: ['Prepositions'],
      lastUpdated: '2026-10-01'
    };
    initial.users.userA.vocabulary = [
      { term: 'hit the sack', meaning: 'go to sleep', example: 'I am tired, time to hit the sack.', addedDate: '2026-10-01', reviewCount: 2 }
    ];
    await saveState(initial);

    // Incoming state has partial userA without profile and vocabulary
    const partialIncoming = {
      users: {
        userA: {
          name: 'Juan Renamed',
          streak: 48
        }
      }
    };
    await saveState(partialIncoming);

    const reloaded = await getState();
    assert.equal(reloaded.users.userA.name, 'Juan Renamed');
    assert.equal(reloaded.users.userA.streak, 48);
    assert.ok(reloaded.users.userA.profile, 'Profile was dropped during partial merge!');
    assert.equal(reloaded.users.userA.profile.cefrLevel, 'B2');
    assert.ok(reloaded.users.userA.vocabulary, 'Vocabulary was dropped during partial merge!');
    assert.equal(reloaded.users.userA.vocabulary[0].term, 'hit the sack');
  });

  // =========================================================================
  // DOMAIN 4: MULTIMODAL & GEMINI ROBUSTNESS
  // =========================================================================
  console.log('  [Domain 4] Multimodal & Gemini Robustness...');

  test('T5.4.1: Malformed JSON response from Gemini handled gracefully with fallback', async () => {
    env.network.customFetchHandlers.unshift(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: "{ intent: 'done', malformed_json: broken... " }] } }]
          }),
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{ intent: 'done', malformed_json: broken... " }] } }]
          })
        };
      }
    });

    const user = { name: "TestUser", timezone: "America/Argentina/Buenos_Aires", streak: 5, shields: 2 };
    const res = await callGemini(user, "Today I practiced English speaking.");
    // When JSON is completely malformed, callGemini retries and eventually returns null safely
    assert.equal(res, null);

    env.network.customFetchHandlers.shift();
  });

  test('T5.4.2: Gemini response wrapped in markdown code fence (```json ... ```) stripped and parsed', async () => {
    const cleanPayload = {
      intent: "done",
      valid: true,
      englishPhrase: "I completed my speaking exercise.",
      feedbackHtml: "<b>Well done!</b>",
      vocabularyItem: { term: "wrap up", meaning: "concluir", example: "Let's wrap up." },
      learningProfileUpdate: { cefrLevel: "B2", strengths: ["Fluency"], focusAreas: ["Idioms"] }
    };

    env.network.customFetchHandlers.unshift(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        const wrapped = "```json\n" + JSON.stringify(cleanPayload) + "\n```";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: wrapped }] } }]
          }),
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: wrapped }] } }]
          })
        };
      }
    });

    const user = { name: "FenceUser", timezone: "America/Argentina/Buenos_Aires", streak: 3, shields: 2 };
    const res = await callGemini(user, "I completed my speaking exercise.");
    assert.notEqual(res, null);
    assert.equal(res.intent, "done");
    assert.equal(res.valid, true);
    assert.equal(res.vocabularyItem.term, "wrap up");

    env.network.customFetchHandlers.shift();
  });

  test('T5.4.3: Gemini response with extra unexpected fields parsed safely without prototype pollution', async () => {
    const dirtyPayload = {
      intent: "done",
      valid: true,
      dynamicReply: "Great practice!",
      maliciousField: "<script>eval()</script>",
      extraData: { count: 99999 },
      __proto__: { polluted: true }
    };

    env.network.customFetchHandlers.unshift(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(dirtyPayload) }] } }]
          }),
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(dirtyPayload) }] } }]
          })
        };
      }
    });

    const user = { name: "PollutionTest", timezone: "America/Argentina/Buenos_Aires", streak: 1, shields: 2 };
    const res = await callGemini(user, "Today I practiced English with the bot.");
    assert.notEqual(res, null);
    assert.equal(res.intent, "done");
    assert.equal(Object.prototype.polluted, undefined, "Prototype pollution occurred!");

    env.network.customFetchHandlers.shift();
  });

  test('T5.4.4: Gemini non-standard CEFR level ("Z9") normalized to fallback CEFR (B1)', async () => {
    const payload = {
      intent: "done",
      valid: true,
      dynamicReply: "Good",
      learningProfileUpdate: {
        cefrLevel: "Z9_SUPER_ADVANCED",
        strengths: ["Speaking"],
        focusAreas: ["Listening"]
      }
    };

    env.network.customFetchHandlers.unshift(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
          }),
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
          })
        };
      }
    });

    const user = { name: "CefrTest", timezone: "America/Argentina/Buenos_Aires", streak: 2, shields: 2 };
    const res = await callGemini(user, "Practicing English phrases today.");
    assert.equal(res.learningProfileUpdate.cefrLevel, "B1");

    env.network.customFetchHandlers.shift();
  });

  test('T5.4.5: Gemini learningProfileUpdate with > 3 strengths/focus areas capped at 3', async () => {
    const payload = {
      intent: "done",
      valid: true,
      dynamicReply: "Solid",
      learningProfileUpdate: {
        cefrLevel: "B2",
        strengths: ["One", "Two", "Three", "Four", "Five"],
        focusAreas: ["AreaA", "AreaB", "AreaC", "AreaD"]
      }
    };

    env.network.customFetchHandlers.unshift(async (url) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
          }),
          text: async () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
          })
        };
      }
    });

    const user = { name: "SliceTest", timezone: "America/Argentina/Buenos_Aires", streak: 2, shields: 2 };
    const res = await callGemini(user, "Practicing English speaking and writing.");
    assert.equal(res.learningProfileUpdate.strengths.length, 3);
    assert.equal(res.learningProfileUpdate.focusAreas.length, 3);

    env.network.customFetchHandlers.shift();
  });

  test('T5.4.6: Audio input polymorphism (Buffer, base64 string, object data) in callGeminiAudio', async () => {
    const rawBuffer = Buffer.from("OGG_MOCK_STREAM");
    const base64Str = rawBuffer.toString('base64');

    // Test with Buffer
    const resBuf = await callGeminiAudio(rawBuffer, { text: "Audio practice check" });
    assert.notEqual(resBuf, null);

    // Test with Base64 String
    const resStr = await callGeminiAudio(base64Str, { text: "Audio practice check" });
    assert.notEqual(resStr, null);

    // Test with Object structure
    const resObj = await callGeminiAudio({ data: base64Str, mimeType: 'audio/ogg' }, { text: "Audio practice check" });
    assert.notEqual(resObj, null);
  });

  test('T5.4.7: Voice note check-in via webhook with multimodal oral feedback successfully updates CEFR profile and vocabulary bank', async () => {
    setMockState(null);
    const initial = getInitialState();
    initial.users.userA.id = "11111";
    initial.users.userA.username = "juan_dev";
    initial.users.userA.streak = 47;
    await saveState(initial);

    const voiceUpdate = {
      update_id: 99881,
      message: {
        message_id: 5544,
        from: { id: "11111", first_name: "Juan", username: "juan_dev" },
        chat: { id: -100123456789 },
        date: Math.floor(Date.now() / 1000),
        voice: {
          file_id: "mock_voice_file_5544",
          duration: 8,
          file_size: 4096,
          mime_type: "audio/ogg"
        }
      }
    };

    const { req, res, getStatusCode } = createMockReqRes('POST', {}, {}, voiceUpdate);
    await webhookHandler(req, res);
    assert.equal(getStatusCode(), 200);

    const updatedState = await getState();
    assert.equal(updatedState.users.userA.streak, 48);
    assert.ok(updatedState.users.userA.vocabulary.length >= 1);
    assert.equal(updatedState.users.userA.profile.cefrLevel, 'B2');
  });

  // =========================================================================
  // DOMAIN 5: STATUS API & DASHBOARD SECURITY FUZZING
  // =========================================================================
  console.log('  [Domain 5] Status API & Security Fuzzing...');

  test('T5.5.1: HTTP Method Rejection: POST, PUT, DELETE, PATCH, OPTIONS return 405 Method Not Allowed', async () => {
    const disallowedMethods = ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
    for (const method of disallowedMethods) {
      const { req, res, getStatusCode, getResponseData, getHeaders } = createMockReqRes(method);
      await statusHandler(req, res);
      assert.equal(getStatusCode(), 405, `Method ${method} should be rejected with 405`);
      assert.deepEqual(getResponseData(), { error: 'Method Not Allowed' });
      assert.equal(getHeaders()['allow'], 'GET');
    }
  });

  test('T5.5.2: Query parameter fuzzing is safely ignored by GET /api/status', async () => {
    const fuzzedQueries = [
      { admin: "true", debug: "1", bypass: "yes" },
      { "__proto__[polluted]": "true" },
      { format: "xml", eval: "process.exit()" },
      { users: "all", limit: "9999999", sql: "SELECT * FROM users" }
    ];

    for (const query of fuzzedQueries) {
      const { req, res, getStatusCode, getResponseData } = createMockReqRes('GET', query);
      await statusHandler(req, res);
      assert.equal(getStatusCode(), 200);
      const data = getResponseData();
      assert.equal(data.status, "ok");
      assert.ok(Array.isArray(data.participants));
      assert.equal(Object.prototype.polluted, undefined);
    }
  });

  test('T5.5.3: Payload sanitization: NEVER leak private IDs, tokens, or chatIds in /api/status', async () => {
    const maliciousState = {
      chatId: -100999999999,
      dailySpark: "What is one goal for today?",
      telegramToken: "SECRET_BOT_TOKEN_DO_NOT_LEAK",
      users: {
        userA: {
          id: "PRIVATE_TELEGRAM_ID_11111",
          username: "juan_private",
          name: "Juan",
          timezone: "America/Argentina/Buenos_Aires",
          streak: 47,
          shields: 2,
          secretApiKey: "SECRET_KEY_USER_A",
          profile: { cefrLevel: "B2" }
        },
        userB: {
          id: "PRIVATE_TELEGRAM_ID_22222",
          username: "sister_private",
          name: "Sister Francy",
          timezone: "America/Mexico_City",
          streak: 18,
          shields: 1,
          profile: { cefrLevel: "B1" }
        }
      }
    };

    const { req, res, getStatusCode, getResponseData } = createMockReqRes('GET');
    await statusHandler(req, res, maliciousState);

    assert.equal(getStatusCode(), 200);
    const data = getResponseData();
    const rawJson = JSON.stringify(data);

    // Strictly ensure no credentials or internal IDs appear anywhere in the output
    assert.doesNotMatch(rawJson, /SECRET_BOT_TOKEN/);
    assert.doesNotMatch(rawJson, /PRIVATE_TELEGRAM_ID/);
    assert.doesNotMatch(rawJson, /SECRET_KEY_USER_A/);
    assert.doesNotMatch(rawJson, /-100999999999/);

    // Verify participant schema has ONLY safe public fields
    for (const p of data.participants) {
      assert.ok(p.name);
      assert.equal(typeof p.streak, 'number');
      assert.equal(typeof p.shields, 'number');
      assert.equal(typeof p.checkedInToday, 'boolean');
      assert.equal(typeof p.shieldedToday, 'boolean');
      assert.equal(typeof p.cefrLevel, 'string');
      assert.equal(p.id, undefined);
      assert.equal(p.telegramToken, undefined);
      assert.equal(p.chatId, undefined);
    }
  });

  test('T5.5.4: Empty or null state resilience in /api/status returns valid 200 fallback', async () => {
    const emptyState = { users: {} };
    const { req, res, getStatusCode, getResponseData } = createMockReqRes('GET');
    await statusHandler(req, res, emptyState);

    assert.equal(getStatusCode(), 200);
    const data = getResponseData();
    assert.equal(data.status, "ok");
    assert.deepEqual(data.participants, []);
    assert.ok(data.dailySpark);
  });

  test('T5.5.5: Corrupted participant streak (string, NaN) normalized to number in /api/status', async () => {
    const corruptedState = {
      users: {
        userA: {
          name: "Juan",
          timezone: "America/Argentina/Buenos_Aires",
          streak: "not_a_number",
          shields: "invalid",
          profile: { cefrLevel: "B2" }
        }
      }
    };

    const { req, res, getStatusCode, getResponseData } = createMockReqRes('GET');
    await statusHandler(req, res, corruptedState);

    assert.equal(getStatusCode(), 200);
    const p = getResponseData().participants[0];
    assert.equal(typeof p.streak, 'number');
    assert.equal(typeof p.shields, 'number');
  });

  test('T5.5.6: Cache-Control and response headers properly set on /api/status', async () => {
    const { req, res, getStatusCode, getHeaders } = createMockReqRes('GET');
    await statusHandler(req, res);
    assert.equal(getStatusCode(), 200);
    const headers = getHeaders();
    assert.equal(headers['content-type'], 'application/json');
    assert.ok(headers['cache-control'].includes('public'));
    assert.ok(headers['cache-control'].includes('max-age'));
  });

  // Clean up mock environment
  env.time.uninstall();
  env.network.uninstall();

  console.log(`\n  Tier 5 Complete: ${passed}/${total} adversarial stress tests passed.\n`);
  return { passed, total };
}

// Auto-run if executed directly
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('tier5-adversarial.test.js') || process.argv[1].endsWith('tier5-adversarial.test'));
if (isDirectRun) {
  runTier5Tests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
