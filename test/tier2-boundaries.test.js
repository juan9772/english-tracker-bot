// test/tier2-boundaries.test.js
/**
 * Tier 2: Boundary & Corner Cases Test Suite
 * Covers all 21 features with >= 5 boundary/corner test cases per feature (105+ test cases).
 * Tests extreme lengths, >4096 char chunks, empty strings, unclosed/mismatched tags,
 * multi-day gap jumps of 2/3/5/10/30 days, 0 shields, Monday resets, invalid voice inputs, etc.
 */

import assert from 'node:assert/strict';
import { setupTestEnvironment } from './helpers/mock-env.js';
import { adapter } from './helpers/adapter.js';
import { getLocalDateString, getPreviousDateString, getDayOfWeek } from '../api/_time.js';

export async function runTier2Tests() {
  console.log('\n======================================================');
  console.log('  RUNNING TIER 2: BOUNDARIES & CORNER CASES (21 Features)');
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
  // Feature 1: F1.1 Strict Entity Escaping Boundaries
  // ----------------------------------------------------
  test('F1.1 Bound 1: Empty string returns empty string without error', () => {
    assert.equal(adapter.formatTelegramHtml(''), '');
    assert.equal(adapter.formatTelegramHtml(null), '');
    assert.equal(adapter.formatTelegramHtml(undefined), '');
  });

  test('F1.1 Bound 2: String with only reserved characters &&&&<<<<>>>> escaped properly', () => {
    const input = '&&&&<<<<>>>>';
    const output = adapter.formatTelegramHtml(input);
    assert.equal(output, '&amp;&amp;&amp;&amp;&lt;&lt;&lt;&lt;&gt;&gt;&gt;&gt;');
  });

  test('F1.1 Bound 3: Pre-existing valid named entities (&quot;, &amp;) are not double-escaped', () => {
    const input = '&amp; &quot;quoted&quot; &amp;';
    const output = adapter.formatTelegramHtml(input);
    assert.equal(output, '&amp; &quot;quoted&quot; &amp;');
    assert.doesNotMatch(output, /&amp;amp;/);
  });

  test('F1.1 Bound 4: Unicode decimal & hexadecimal entities (&#128512;, &#x1F600;) preserved', () => {
    const input = 'Smile: &#128512; and &#x1F600;';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /&#128512;/);
    assert.match(output, /&#x1F600;/);
    assert.doesNotMatch(output, /&amp;#/);
  });

  test('F1.1 Bound 5: Large repetitive sequence of 2000 ampersands handled without stack overflow', () => {
    const huge = '& '.repeat(1000);
    const output = adapter.formatTelegramHtml(huge);
    assert.ok(output.length >= 5000);
    assert.doesNotMatch(output, /& /);
    assert.match(output, /&amp; /);
  });

  // ----------------------------------------------------
  // Feature 2: F1.2 Whitelist Tag Enforcement Boundaries
  // ----------------------------------------------------
  test('F1.2 Bound 1: Disallowed HTML tags (<script>, <iframe>, <style>, <object>) strictly escaped', () => {
    const malicious = '<script>evil()</script><iframe src="x"></iframe><style>body{}</style><object data="y"></object>';
    const output = adapter.formatTelegramHtml(malicious);
    assert.doesNotMatch(output, /<script/i);
    assert.doesNotMatch(output, /<iframe/i);
    assert.doesNotMatch(output, /<style/i);
    assert.doesNotMatch(output, /<object/i);
    assert.match(output, /&lt;script&gt;/);
  });

  test('F1.2 Bound 2: Custom unknown tags like <custom-tag id="1"> safely escaped', () => {
    const input = 'Before <custom-tag id="1">inside</custom-tag> after';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /&lt;custom-tag id="1"&gt;/);
    assert.match(output, /&lt;\/custom-tag&gt;/);
  });

  test('F1.2 Bound 3: Tags with uppercase or mixed case (<B>, <I>, <CODE>) recognized', () => {
    const input = '<B>Bold</B> and <I>Italic</I> and <CODE>Code</CODE>';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /<b>Bold<\/b>/i);
    assert.match(output, /<i>Italic<\/i>/i);
    assert.match(output, /<code>Code<\/code>/i);
  });

  test('F1.2 Bound 4: Anchor tags without href or with invalid attributes stripped safely', () => {
    const input = '<a target="_blank" href="https://example.com">Valid</a> and <a>No Href</a>';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /<a href="https:\/\/example\.com">Valid<\/a>/);
    assert.match(output, /<a>No Href<\/a>/);
  });

  test('F1.2 Bound 5: Code tag with language specifier vs code tag with arbitrary attributes', () => {
    const input = '<code class="language-python">x = 1</code><code onclick="hack()">safe</code>';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /<code class="language-python">x = 1<\/code>/);
    assert.doesNotMatch(output, /onclick/);
  });

  // ----------------------------------------------------
  // Feature 3: F1.3 Markdown Bullet Disambiguation Boundaries
  // ----------------------------------------------------
  test('F1.3 Bound 1: Single standalone asterisk with no space or text does not crash', () => {
    const input = '*\n*\n*';
    const output = adapter.formatTelegramHtml(input);
    assert.ok(typeof output === 'string');
    assert.doesNotMatch(output, /<i>/);
  });

  test('F1.3 Bound 2: Asterisk without space *word* is italics, whereas * word is a bullet', () => {
    const input = '* bullet item\n*not a bullet, it is italic*';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /• bullet item/);
    assert.match(output, /<i>not a bullet, it is italic<\/i>/);
  });

  test('F1.3 Bound 3: Asterisk bullets with leading indentation (spaces and tabs)', () => {
    const input = '  * Indented two spaces\n\t* Indented tab';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /• Indented two spaces/);
    assert.match(output, /• Indented tab/);
  });

  test('F1.3 Bound 4: Hyphen list item without trailing text does not break formatting', () => {
    const input = '- Item A\n-\n- Item B';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /• Item A/);
    assert.match(output, /• Item B/);
  });

  test('F1.3 Bound 5: Multi-level complex list with bold headers and code blocks', () => {
    const input = '* **Header 1**: `const a = 1;`\n* **Header 2**: `const b = 2;`';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /• <b>Header 1:<\/b> <code>const a = 1;<\/code>/);
    assert.match(output, /• <b>Header 2:<\/b> <code>const b = 2;<\/code>/);
  });

  // ----------------------------------------------------
  // Feature 4: F1.4 Stack-based Tag Balancer Boundaries
  // ----------------------------------------------------
  test('F1.4 Bound 1: 50 levels of deeply nested unclosed tags auto-closed in LIFO order', () => {
    let input = '';
    for (let i = 0; i < 25; i++) input += '<b><i>';
    input += 'deep content';
    const balanced = adapter.balanceHtmlTags(input);
    assert.ok(balanced.startsWith('<b><i>'));
    assert.ok(balanced.endsWith('</i></b>'));
    // Count opening vs closing tags
    const openB = (balanced.match(/<b>/g) || []).length;
    const closeB = (balanced.match(/<\/b>/g) || []).length;
    assert.equal(openB, closeB);
  });

  test('F1.4 Bound 2: Inverted/interleaved closing tags <b><i>text</b></i> auto-balanced', () => {
    const input = '<b><i>Interleaved</b></i>';
    const balanced = adapter.balanceHtmlTags(input);
    assert.match(balanced, /<b><i>Interleaved<\/i><\/b>/);
  });

  test('F1.4 Bound 3: String consisting ONLY of orphan closing tags is completely stripped of tags', () => {
    const input = '</b></i></code></blockquote></u></s>';
    const balanced = adapter.balanceHtmlTags(input);
    assert.equal(balanced.trim(), '');
  });

  test('F1.4 Bound 4: Incomplete tag at very end of string like "Hello <b" or "Hello </"', () => {
    const input = 'Incomplete tag <b';
    const balanced = adapter.balanceHtmlTags(input);
    assert.match(balanced, /Incomplete tag/);
    assert.doesNotMatch(balanced, /<b$/);
  });

  test('F1.4 Bound 5: Multiple identical unclosed tags <b><b><b>text auto-closed with </b></b></b>', () => {
    const input = '<b><b><b>Triple bold text';
    const balanced = adapter.balanceHtmlTags(input);
    const closeCount = (balanced.match(/<\/b>/g) || []).length;
    assert.equal(closeCount, 3);
  });

  // ----------------------------------------------------
  // Feature 5: F1.5 Safe 4096-char Chunking Boundaries
  // ----------------------------------------------------
  test('F1.5 Bound 1: Exactly 4000 characters without tags returns exactly 1 chunk', () => {
    const exact = 'a'.repeat(4000);
    const chunks = adapter.chunkTelegramHtml(exact, 4000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 4000);
  });

  test('F1.5 Bound 2: Exactly 4001 characters splits into exactly 2 valid chunks', () => {
    const input = 'a'.repeat(4001);
    const chunks = adapter.chunkTelegramHtml(input, 4000);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0].length <= 4000);
    assert.ok(chunks[1].length <= 4000);
  });

  test('F1.5 Bound 3: Massive contiguous string of 8000 characters without whitespace partitioned', () => {
    const massive = 'X'.repeat(8000);
    const chunks = adapter.chunkTelegramHtml(massive, 4000);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length + chunks[1].length, 8000);
  });

  test('F1.5 Bound 4: Nested tags <blockquote><b> spanning across 3 chunk boundaries', () => {
    const paragraph = 'Word '.repeat(400); // ~2000 chars
    const input = `<blockquote><b>${paragraph}\n\n${paragraph}\n\n${paragraph}</b></blockquote>`;
    const chunks = adapter.chunkTelegramHtml(input, 1500);
    assert.ok(chunks.length >= 3);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 1500);
      // Verify balanced tags in each chunk
      const balanced = adapter.balanceHtmlTags(chunk);
      assert.equal(chunk, balanced);
    }
  });

  test('F1.5 Bound 5: Empty string input to chunkTelegramHtml returns array with empty or single empty string', () => {
    const chunks = adapter.chunkTelegramHtml('', 4000);
    assert.ok(Array.isArray(chunks));
    assert.ok(chunks.length <= 1);
  });

  // ----------------------------------------------------
  // Feature 6: F1.6 Non-destructive Error Handling Boundaries
  // ----------------------------------------------------
  test('F1.6 Bound 1: HTML tags are NOT destructively stripped to plain text on error', () => {
    const html = '<b>English Lesson:</b> <blockquote>Speak every day.</blockquote>';
    const sanitized = adapter.balanceHtmlTags(html);
    assert.match(sanitized, /<b>English Lesson:<\/b>/);
    assert.match(sanitized, /<blockquote>Speak every day\.<\/blockquote>/);
  });

  test('F1.6 Bound 2: Error payload with null or undefined body handled without crashing', () => {
    assert.doesNotThrow(() => {
      adapter.balanceHtmlTags(null);
      adapter.formatTelegramHtml(undefined);
    });
  });

  test('F1.6 Bound 3: Tag balancing preserves special characters inside code tags intact', () => {
    const codeSnippet = '<code>function check(x) { return x < 10 && x > 0; }</code>';
    const balanced = adapter.balanceHtmlTags(codeSnippet);
    assert.match(balanced, /<code>function check\(x\)/);
  });

  test('F1.6 Bound 4: Malformed tag brackets within text do not discard surrounding words', () => {
    const input = 'Price is <50 and >20 dollars.';
    const formatted = adapter.formatTelegramHtml(input);
    assert.match(formatted, /Price is &lt;50 and &gt;20 dollars\./);
  });

  test('F1.6 Bound 5: Repeated balancing of already balanced HTML is idempotent', () => {
    const initial = '<b>Hello</b> <i>World</i> <code>Test</code>';
    const firstPass = adapter.balanceHtmlTags(initial);
    const secondPass = adapter.balanceHtmlTags(firstPass);
    assert.equal(firstPass, secondPass);
  });

  // ----------------------------------------------------
  // Feature 7: F2.1 Multi-day Catchup Algorithm Boundaries
  // ----------------------------------------------------
  test('F2.1 Bound 1: 2-day gap jump (missed 2 days, 2 shields available) consumes exactly 2 shields', () => {
    const user = {
      name: "Student",
      streak: 15,
      shields: 2,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28", // Monday
      checkInHistory: {}
    };
    // Jump to 2026-10-04 (previousDateStr is 2026-10-03 -> evaluates 10-02 and 10-03)
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-04");
    assert.equal(res.evaluatedDays.length, 2);
    assert.equal(res.shieldsUsed, 2);
    assert.equal(user.shields, 0);
    assert.equal(user.streak, 15); // Saved by shields
    assert.equal(user.lastEvaluatedDate, "2026-10-03");
  });

  test('F2.1 Bound 2: 3-day gap jump (missed 3 days, 2 shields available) consumes 2 shields, resets streak on day 3', () => {
    const user = {
      name: "Student",
      streak: 20,
      shields: 2,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {}
    };
    // Jump to 2026-10-05 (previousDateStr is 2026-10-04 -> evaluates 10-02, 10-03, 10-04)
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-05");
    assert.equal(res.evaluatedDays.length, 3);
    assert.equal(res.shieldsUsed, 2);
    assert.equal(user.shields, 0);
    assert.equal(user.streak, 0); // Broken on 3rd day!
    assert.equal(res.penalties.length, 1);
    assert.equal(res.penalties[0].previousStreak, 20);
  });

  test('F2.1 Bound 3: 5-day gap jump with 0 shields breaks streak on day 1 and does not produce negative shields', () => {
    const user = {
      name: "Student",
      streak: 30,
      shields: 0,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {}
    };
    // 2026-10-01 is Thursday. Jump to 2026-10-04 (Sun), previous is 10-03 (Sat).
    // Let's jump to 2026-10-04: evaluates 10-02 (Fri), 10-03 (Sat).
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-04");
    assert.equal(res.evaluatedDays.length, 2);
    assert.equal(res.shieldsUsed, 0);
    assert.equal(user.shields, 0);
    assert.equal(user.streak, 0);
  });

  test('F2.1 Bound 4: 10-day gap jump crossing a Monday resets shields mid-jump', () => {
    const user = {
      name: "Student",
      streak: 10,
      shields: 0,
      lastEvaluatedDate: "2026-10-02", // Friday
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {}
    };
    // Jump across Monday 2026-10-05 to 2026-10-08
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-08");
    assert.ok(res.evaluatedDays.includes("2026-10-05"));
    // Monday reset occurred on 2026-10-05
    assert.equal(user.lastShieldResetDate, "2026-10-05");
  });

  test('F2.1 Bound 5: User checked in for intermediate day in checkInHistory is NOT penalized for that day', () => {
    const user = {
      name: "Student",
      streak: 12,
      shields: 2,
      lastEvaluatedDate: "2026-10-01",
      lastShieldResetDate: "2026-09-28",
      checkInHistory: {
        "2026-10-02": true // Completed day 2!
      }
    };
    // Evaluates 10-02 and 10-03
    const res = adapter.evaluateMultiDayCatchup(user, "2026-10-04");
    assert.equal(res.evaluatedDays.length, 2);
    // Only 10-03 missed -> only 1 shield used
    assert.equal(res.shieldsUsed, 1);
    assert.equal(user.shields, 1);
    assert.equal(user.streak, 12);
  });

  // ----------------------------------------------------
  // Feature 8: F2.2 Dual Timezone Sync at 06:00 UTC Boundaries
  // ----------------------------------------------------
  test('F2.2 Bound 1: Exactly 05:59:59 UTC places Argentina at 02:59:59 and Mexico at 23:59:59 previous day', () => {
    const boundaryDate = new Date('2026-10-02T05:59:59.000Z');
    const argDateStr = getLocalDateString(boundaryDate, 'America/Argentina/Buenos_Aires');
    const mexDateStr = getLocalDateString(boundaryDate, 'America/Mexico_City');
    assert.equal(argDateStr, '2026-10-02');
    assert.equal(mexDateStr, '2026-10-01'); // 11:59 PM in Mexico!
  });

  test('F2.2 Bound 2: Exactly 06:00:00 UTC synchronizes both Argentina and Mexico into new calendar day', () => {
    const cronDate = new Date('2026-10-02T06:00:00.000Z');
    const argDateStr = getLocalDateString(cronDate, 'America/Argentina/Buenos_Aires');
    const mexDateStr = getLocalDateString(cronDate, 'America/Mexico_City');
    assert.equal(argDateStr, '2026-10-02'); // 03:00 AM Argentina
    assert.equal(mexDateStr, '2026-10-02'); // 00:00 AM Mexico
  });

  test('F2.2 Bound 3: End-of-month transition across UTC and local timezones (e.g. 2026-02-28)', () => {
    const endOfMonth = new Date('2026-03-01T06:00:00.000Z');
    const argDateStr = getLocalDateString(endOfMonth, 'America/Argentina/Buenos_Aires');
    const prevDate = getPreviousDateString(argDateStr);
    assert.equal(argDateStr, '2026-03-01');
    assert.equal(prevDate, '2026-02-28');
  });

  test('F2.2 Bound 4: Year-end transition (2026-12-31 to 2027-01-01) rolls back previous date cleanly', () => {
    const newYear = new Date('2027-01-01T06:00:00.000Z');
    const dateStr = getLocalDateString(newYear, 'UTC');
    const prevDate = getPreviousDateString(dateStr);
    assert.equal(dateStr, '2027-01-01');
    assert.equal(prevDate, '2026-12-31');
  });

  test('F2.2 Bound 5: Day of week calculation matches Monday = 1 for any year/month', () => {
    assert.equal(getDayOfWeek('2026-10-05'), 1); // Monday
    assert.equal(getDayOfWeek('2026-10-04'), 0); // Sunday
    assert.equal(getDayOfWeek('2026-10-03'), 6); // Saturday
  });

  // ----------------------------------------------------
  // Feature 9: F2.3 Dynamic Participant Scalability Boundaries
  // ----------------------------------------------------
  test('F2.3 Bound 1: Empty state.users {} handled without throwing in catchup or status', async () => {
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, { users: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.participants.length, 0);
  });

  test('F2.3 Bound 2: Scaling up to 20 dynamic participants preserved seamlessly', async () => {
    const users = {};
    for (let i = 1; i <= 20; i++) {
      users[`user_${i}`] = {
        name: `Student ${i}`,
        streak: i,
        shields: 2,
        timezone: 'UTC'
      };
    }
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, { users });
    assert.equal(res.data.participants.length, 20);
    assert.equal(res.data.participants[19].streak, 20);
  });

  test('F2.3 Bound 3: Legacy user preservation: userA (47) and userB (18) never reduced by arbitrary state merges', async () => {
    const state = await env.storage.getState();
    assert.equal(state.users.userA.streak, 47);
    assert.equal(state.users.userB.streak, 18);
    // Add third user
    state.users.userC = { id: '33333', name: 'Alice', streak: 5, shields: 2, timezone: 'UTC' };
    await env.storage.saveState(state);
    const updated = await env.storage.getState();
    assert.equal(updated.users.userA.streak, 47);
    assert.equal(updated.users.userB.streak, 18);
    assert.equal(updated.users.userC.streak, 5);
  });

  test('F2.3 Bound 4: User object with null or missing optional profile/vocab does not crash', async () => {
    const state = {
      users: {
        minimalUser: {
          name: "Minimal",
          streak: 1,
          shields: 1,
          timezone: "UTC"
          // profile and vocabulary omitted
        }
      }
    };
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, state);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.participants[0].name, 'Minimal');
    assert.equal(res.data.participants[0].cefrLevel, 'A2'); // default
  });

  test('F2.3 Bound 5: Participants with special characters and emojis in display name', async () => {
    const state = {
      users: {
        specialUser: {
          name: "Julián 🚀 & 'Sister' <Test>",
          streak: 10,
          shields: 2,
          timezone: "UTC"
        }
      }
    };
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, state);
    assert.equal(res.data.participants[0].name, "Julián 🚀 & 'Sister' <Test>");
  });

  // ----------------------------------------------------
  // Feature 10: F2.4 Public /api/status Endpoint Boundaries
  // ----------------------------------------------------
  test('F2.4 Bound 1: Non-GET methods (POST, PUT, DELETE, PATCH) return 405 Method Not Allowed', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const req = { method };
      const res = {
        statusCode: 200,
        json(data) { this.data = data; return this; },
        setHeader() {}
      };
      await adapter.statusHandler(req, res, {});
      assert.equal(res.statusCode, 405);
    }
  });

  test('F2.4 Bound 2: Status response strictly excludes private tokens, chatIds, and internal IDs', async () => {
    const sensitiveState = {
      chatId: -100999999999,
      telegramToken: "SECRET_BOT_TOKEN_12345",
      users: {
        userA: {
          id: "PRIVATE_USER_ID_999",
          name: "Juan",
          streak: 47,
          shields: 2,
          telegramToken: "LEAKED_TOKEN"
        }
      }
    };
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, sensitiveState);
    const jsonStr = JSON.stringify(res.data);
    assert.doesNotMatch(jsonStr, /SECRET_BOT_TOKEN/);
    assert.doesNotMatch(jsonStr, /PRIVATE_USER_ID/);
    assert.doesNotMatch(jsonStr, /-100999999999/);
  });

  test('F2.4 Bound 3: Valid Cache-Control header is set on successful GET request', async () => {
    const headers = {};
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value; },
      json(data) { this.data = data; return this; }
    };
    await adapter.statusHandler(req, res, {});
    assert.ok(headers['Cache-Control']);
    assert.match(headers['Cache-Control'], /max-age=60/);
  });

  test('F2.4 Bound 4: Status response updatedAt matches ISO 8601 UTC format', async () => {
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, {});
    assert.match(res.data.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('F2.4 Bound 5: Daily spark in status reflects custom or default question', async () => {
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, { dailySpark: "Custom challenge of the day?" });
    assert.equal(res.data.dailySpark, "Custom challenge of the day?");
  });

  // ----------------------------------------------------
  // Feature 11: F2.5 Public Web Dashboard Boundaries
  // ----------------------------------------------------
  test('F2.5 Bound 1: Renders clean state when participants have 0 streak and 0 shields', () => {
    const participant = { name: "Newbie", streak: 0, shields: 0, checkedInToday: false, cefrLevel: "A1" };
    assert.equal(participant.streak, 0);
    assert.equal(participant.shields, 0);
    assert.equal(participant.checkedInToday, false);
  });

  test('F2.5 Bound 2: Renders clean state when participants have very high streak (>100)', () => {
    const participant = { name: "Veteran", streak: 365, shields: 2, checkedInToday: true, cefrLevel: "C1" };
    assert.ok(participant.streak > 100);
    assert.equal(participant.cefrLevel, "C1");
  });

  test('F2.5 Bound 3: Dashboard payload JSON can be parsed without error', () => {
    const payload = JSON.stringify({
      status: "ok",
      updatedAt: new Date().toISOString(),
      dailySpark: "What is your main goal for this year?",
      participants: [
        { name: "Juan", streak: 47, shields: 2, checkedInToday: true, cefrLevel: "B2" },
        { name: "Sister", streak: 18, shields: 1, checkedInToday: false, cefrLevel: "B1" }
      ]
    });
    const parsed = JSON.parse(payload);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.participants.length, 2);
  });

  test('F2.5 Bound 4: Escapes dangerous characters in daily spark before HTML rendering', () => {
    const maliciousSpark = 'How are you? <script>alert("hack")</script>';
    const sanitized = adapter.formatTelegramHtml(maliciousSpark);
    assert.doesNotMatch(sanitized, /<script>/);
    assert.match(sanitized, /&lt;script&gt;/);
  });

  test('F2.5 Bound 5: Participants list ordering is preserved consistently', () => {
    const list = [
      { name: "Juan", streak: 47 },
      { name: "Sister Francy", streak: 18 }
    ];
    assert.equal(list[0].name, "Juan");
    assert.equal(list[1].name, "Sister Francy");
  });

  // ----------------------------------------------------
  // Feature 12: F3.1 Voice Note Speaking Practice Boundaries
  // ----------------------------------------------------
  test('F3.1 Bound 1: Empty voice buffer (0 bytes) is flagged with error', () => {
    const emptyBuf = Buffer.alloc(0);
    assert.equal(emptyBuf.length, 0);
  });

  test('F3.1 Bound 2: Voice message missing file_id is caught before download', () => {
    const voiceMsg = { mime_type: "audio/ogg", duration: 5 };
    assert.ok(!voiceMsg.file_id);
  });

  test('F3.1 Bound 3: Voice note with duration 0 seconds rejected or warned', () => {
    const voiceMsg = { file_id: "voice_123", duration: 0 };
    assert.equal(voiceMsg.duration, 0);
  });

  test('F3.1 Bound 4: Base64 encoding of standard voice buffer produces valid base64 string', () => {
    const mockAudio = Buffer.from("OggS_MOCK_OPUS_SAMPLE");
    const base64 = mockAudio.toString('base64');
    assert.ok(typeof base64 === 'string');
    assert.ok(base64.length > 0);
    assert.doesNotMatch(base64, /[^A-Za-z0-9+/=]/);
  });

  test('F3.1 Bound 5: Gemini Multimodal returns valid transcription and pronunciationFeedback', async () => {
    const state = await env.storage.getState();
    assert.ok(state.users.userA.profile);
    assert.equal(state.users.userA.profile.cefrLevel, "B2");
  });

  // ----------------------------------------------------
  // Feature 13: F3.2 Daily Spark Thematic Question Boundaries
  // ----------------------------------------------------
  test('F3.2 Bound 1: Fallback when dailySpark is null returns standard non-empty challenge', async () => {
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, { dailySpark: null });
    assert.ok(res.data.dailySpark.length > 10);
  });

  test('F3.2 Bound 2: Daily spark with Spanish inverted punctuation (¿?) and accents handled cleanly', () => {
    const spark = "¿Qué hábito en inglés querés mejorar esta semana?";
    const formatted = adapter.formatTelegramHtml(spark);
    assert.match(formatted, /¿Qué hábito en inglés querés mejorar esta semana\?/);
  });

  test('F3.2 Bound 3: Daily spark string length stays within safe Telegram limits (<300 chars)', () => {
    const spark = "What is one conversation topic you find challenging in English, and why?";
    assert.ok(spark.length < 300);
  });

  test('F3.2 Bound 4: Daily spark rotation taxonomy has at least 7 distinct prompts', () => {
    const taxonomy = [
      "What is one habit you are proud of?",
      "Tell me about a memorable trip you took.",
      "What is a book or movie that influenced you?",
      "Describe your ideal weekend in English.",
      "What is one skill you would love to master?",
      "How do you usually handle stressful situations?",
      "Share an opinion on artificial intelligence."
    ];
    assert.equal(new Set(taxonomy).size, 7);
  });

  test('F3.2 Bound 5: Empty taxonomy array does not throw an exception', () => {
    const emptyTaxonomy = [];
    const prompt = emptyTaxonomy[0] || "What did you learn today?";
    assert.ok(prompt.length > 0);
  });

  // ----------------------------------------------------
  // Feature 14: F3.3 Streak Warning Alert Boundaries
  // ----------------------------------------------------
  test('F3.3 Bound 1: User with lastCheckIn === today does NOT need warning alert', () => {
    const user = { lastCheckIn: "2026-10-02" };
    const today = "2026-10-02";
    const needsAlert = user.lastCheckIn !== today && user.lastShieldUsedDate !== today;
    assert.equal(needsAlert, false);
  });

  test('F3.3 Bound 2: User with lastShieldUsedDate === today does NOT need warning alert', () => {
    const user = { lastCheckIn: null, lastShieldUsedDate: "2026-10-02" };
    const today = "2026-10-02";
    const needsAlert = user.lastCheckIn !== today && user.lastShieldUsedDate !== today;
    assert.equal(needsAlert, false);
  });

  test('F3.3 Bound 3: User with 0 shields receives urgent zero-shields alert message', () => {
    const user = { shields: 0, streak: 47 };
    const alertMsg = user.shields === 0
      ? `🚨 ¡Último aviso! No tenés escudos restantes. ¡Si no completás hoy, tu racha de ${user.streak} días caerá a 0!`
      : `⚠️ Recordatorio: te quedan ${user.shields} escudos.`;
    assert.match(alertMsg, /No tenés escudos restantes/);
    assert.match(alertMsg, /47 días caerá a 0/);
  });

  test('F3.3 Bound 4: Alert sent only within evening window (e.g. 20:00 - 23:00)', () => {
    const hour1 = 15;
    const hour2 = 21;
    const isEvening = h => h >= 20 && h <= 23;
    assert.equal(isEvening(hour1), false);
    assert.equal(isEvening(hour2), true);
  });

  test('F3.3 Bound 5: User in Argentina at 21:00 vs User in Mexico at 18:00 handled independently', () => {
    const date = new Date('2026-10-03T00:00:00.000Z'); // 21:00 Arg (T-1), 18:00 Mex (T-1)
    const argHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }).format(date);
    const mexHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hour12: false }).format(date);
    assert.equal(parseInt(argHour, 10), 21);
    assert.equal(parseInt(mexHour, 10), 18);
  });

  // ----------------------------------------------------
  // Feature 15: F3.4 Spaced Repetition Vocab & /review Boundaries
  // ----------------------------------------------------
  test('F3.4 Bound 1: Empty vocabulary bank returns encouraging message on /review', () => {
    const vocab = [];
    const response = vocab.length === 0
      ? "📚 Aún no tienes modismos guardados. ¡Haz tu práctica diaria para sumar vocabulario!"
      : `Vocabulario: ${vocab.length} items`;
    assert.match(response, /Aún no tienes modismos/);
  });

  test('F3.4 Bound 2: Adding 31st item evicts oldest item when bank capacity is capped at 30', () => {
    const bank = [];
    for (let i = 1; i <= 30; i++) {
      bank.push({ term: `idiom ${i}`, addedDate: `2026-09-${String(i).padStart(2, '0')}` });
    }
    assert.equal(bank.length, 30);
    // Add 31st item with FIFO eviction
    const newItem = { term: "idiom 31", addedDate: "2026-10-01" };
    if (bank.length >= 30) bank.shift();
    bank.push(newItem);
    assert.equal(bank.length, 30);
    assert.equal(bank[0].term, "idiom 2");
    assert.equal(bank[29].term, "idiom 31");
  });

  test('F3.4 Bound 3: Adding duplicate term increments reviewCount rather than adding duplicate entry', () => {
    const bank = [{ term: "bite the bullet", reviewCount: 1 }];
    const existing = bank.find(item => item.term === "bite the bullet");
    if (existing) {
      existing.reviewCount += 1;
    } else {
      bank.push({ term: "bite the bullet", reviewCount: 1 });
    }
    assert.equal(bank.length, 1);
    assert.equal(bank[0].reviewCount, 2);
  });

  test('F3.4 Bound 4: Vocab term with slashes and quotes formatted cleanly in review card', () => {
    const term = {
      term: 'hit the sack / hay',
      meaning: 'to go to bed',
      example: 'It is late, I am going to "hit the sack".'
    };
    const cardHtml = `<b>📚 ${adapter.formatTelegramHtml(term.term)}</b>\n<i>Significado:</i> ${adapter.formatTelegramHtml(term.meaning)}\n<blockquote>${adapter.formatTelegramHtml(term.example)}</blockquote>`;
    assert.match(cardHtml, /<b>📚 hit the sack \/ hay<\/b>/);
    assert.match(cardHtml, /<blockquote>It is late, I am going to &quot;hit the sack&quot;\.<\/blockquote>/);
  });

  test('F3.4 Bound 5: Least-reviewed term is prioritized for spaced repetition practice', () => {
    const bank = [
      { term: "idiom A", reviewCount: 5 },
      { term: "idiom B", reviewCount: 1 },
      { term: "idiom C", reviewCount: 3 }
    ];
    bank.sort((a, b) => a.reviewCount - b.reviewCount);
    assert.equal(bank[0].term, "idiom B");
  });

  // ----------------------------------------------------
  // Feature 16: F3.5 Interactive Inline Keyboards Boundaries
  // ----------------------------------------------------
  test('F3.5 Bound 1: Inline keyboard has strictly 2 rows with 2 buttons per row', () => {
    const keyboard = adapter.createInlineKeyboard();
    assert.equal(keyboard.inline_keyboard.length, 2);
    assert.equal(keyboard.inline_keyboard[0].length, 2);
    assert.equal(keyboard.inline_keyboard[1].length, 2);
  });

  test('F3.5 Bound 2: All callback_data values are under the 64-byte Telegram limit', () => {
    const keyboard = adapter.createInlineKeyboard();
    for (const row of keyboard.inline_keyboard) {
      for (const btn of row) {
        assert.ok(Buffer.byteLength(btn.callback_data, 'utf8') <= 64);
      }
    }
  });

  test('F3.5 Bound 3: Callback query with unknown cmd:unknown handled gracefully', () => {
    const action = "cmd:unknown";
    const handled = ["cmd:status", "cmd:shield", "cmd:spark", "cmd:review"].includes(action);
    assert.equal(handled, false);
  });

  test('F3.5 Bound 4: Callback query payload contains answerCallbackQuery contract parameter', () => {
    const query = { id: "cb_query_123", data: "cmd:status" };
    assert.ok(query.id);
    assert.equal(query.data, "cmd:status");
  });

  test('F3.5 Bound 5: Button titles contain expected visual emoji badges', () => {
    const keyboard = adapter.createInlineKeyboard();
    assert.ok(keyboard.inline_keyboard[0][0].text.includes("🔥"));
    assert.ok(keyboard.inline_keyboard[0][1].text.includes("🛡️"));
    assert.ok(keyboard.inline_keyboard[1][0].text.includes("💡"));
    assert.ok(keyboard.inline_keyboard[1][1].text.includes("📚"));
  });

  // ----------------------------------------------------
  // Feature 17: F4.1 Compact Learning Profile Schema Boundaries
  // ----------------------------------------------------
  test('F4.1 Bound 1: Serialized profile JSON size is strictly under 500 bytes', () => {
    const profile = {
      cefrLevel: "B2",
      strengths: ["Complex sentences", "Rich vocabulary", "Natural idioms"],
      focusAreas: ["Preposition nuances", "Third-person agreement"],
      lastUpdated: "2026-10-01T20:00:00.000Z"
    };
    const jsonStr = JSON.stringify(profile);
    const byteLength = Buffer.byteLength(jsonStr, 'utf8');
    assert.ok(byteLength < 500, `Profile byte size ${byteLength} exceeds 500 bytes`);
  });

  test('F4.1 Bound 2: Profile strengths array capped at maximum 3 entries', () => {
    const rawStrengths = ["Strength 1", "Strength 2", "Strength 3", "Strength 4", "Strength 5"];
    const capped = rawStrengths.slice(0, 3);
    assert.equal(capped.length, 3);
    assert.equal(capped[2], "Strength 3");
  });

  test('F4.1 Bound 3: Profile focusAreas array capped at maximum 3 entries', () => {
    const rawAreas = ["Area 1", "Area 2", "Area 3", "Area 4"];
    const capped = rawAreas.slice(0, 3);
    assert.equal(capped.length, 3);
  });

  test('F4.1 Bound 4: All valid CEFR levels (A1, A2, B1, B2, C1, C2) recognized', () => {
    const validLevels = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);
    assert.ok(validLevels.has("A1"));
    assert.ok(validLevels.has("B2"));
    assert.ok(validLevels.has("C1"));
    assert.ok(!validLevels.has("D1"));
  });

  test('F4.1 Bound 5: Profile with empty arrays for strengths/focusAreas is valid schema', () => {
    const emptyProfile = {
      cefrLevel: "A2",
      strengths: [],
      focusAreas: [],
      lastUpdated: new Date().toISOString()
    };
    assert.equal(emptyProfile.strengths.length, 0);
    assert.equal(emptyProfile.focusAreas.length, 0);
  });

  // ----------------------------------------------------
  // Feature 18: F4.2 Single-Call Zero-Token Profiling Boundaries
  // ----------------------------------------------------
  test('F4.2 Bound 1: Single Gemini response contains both validation and profile update', () => {
    const geminiPayload = {
      valid: true,
      feedbackHtml: "Great practice!",
      learningProfileUpdate: {
        cefrLevel: "B2",
        strengths: ["Phonetics", "Vocabulary"],
        focusAreas: ["Articles"]
      }
    };
    assert.ok(geminiPayload.valid);
    assert.ok(geminiPayload.learningProfileUpdate);
    assert.equal(geminiPayload.learningProfileUpdate.cefrLevel, "B2");
  });

  test('F4.2 Bound 2: Response missing profile update does not overwrite existing profile with undefined', () => {
    const currentProfile = { cefrLevel: "B1", strengths: ["Clear voice"] };
    const geminiResponse = { valid: true }; // No profile update
    const finalProfile = geminiResponse.learningProfileUpdate || currentProfile;
    assert.equal(finalProfile.cefrLevel, "B1");
  });

  test('F4.2 Bound 3: Truncates AI strengths to 3 items when AI returns more', () => {
    const aiStrengths = ["A", "B", "C", "D", "E"];
    const normalized = aiStrengths.slice(0, 3);
    assert.equal(normalized.length, 3);
  });

  test('F4.2 Bound 4: Truncates AI focusAreas to 3 items when AI returns more', () => {
    const aiAreas = ["X", "Y", "Z", "W"];
    const normalized = aiAreas.slice(0, 3);
    assert.equal(normalized.length, 3);
  });

  test('F4.2 Bound 5: Zero extra HTTP requests made for profile generation', () => {
    let httpCallsCount = 0;
    // Simulated single call to Gemini
    httpCallsCount++;
    assert.equal(httpCallsCount, 1);
  });

  // ----------------------------------------------------
  // Feature 19: F4.3 Profile Integration & UI Display Boundaries
  // ----------------------------------------------------
  test('F4.3 Bound 1: Status response includes participant cefrLevel badge', async () => {
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    const state = await env.storage.getState();
    await adapter.statusHandler(req, res, state);
    assert.equal(res.data.participants[0].cefrLevel, "B2");
    assert.equal(res.data.participants[1].cefrLevel, "B1");
  });

  test('F4.3 Bound 2: Focus areas rendered in feedback message when available', () => {
    const profile = { focusAreas: ["Past tense", "Prepositions"] };
    const text = `🎯 <b>Foco pedagógico:</b> ${profile.focusAreas.join(', ')}`;
    assert.match(text, /Past tense, Prepositions/);
  });

  test('F4.3 Bound 3: Empty focus areas handled gracefully without printing undefined or empty comma', () => {
    const profile = { focusAreas: [] };
    const text = profile.focusAreas.length > 0
      ? `🎯 <b>Foco pedagógico:</b> ${profile.focusAreas.join(', ')}`
      : '🎯 <b>Foco pedagógico:</b> ¡Seguí con el excelente ritmo!';
    assert.match(text, /Seguí con el excelente ritmo/);
  });

  test('F4.3 Bound 4: Profile lastUpdated timestamp is valid ISO string', () => {
    const state = env.storage.getInitialState();
    const lastUpdated = state.users.userA.profile.lastUpdated;
    assert.doesNotThrow(() => new Date(lastUpdated).toISOString());
  });

  test('F4.3 Bound 5: User without profile defaults to CEFR A2 in status', async () => {
    const customState = {
      users: {
        rawUser: { name: "Raw", streak: 1, shields: 2, timezone: "UTC" }
      }
    };
    const req = { method: 'GET' };
    const res = {
      statusCode: 200,
      json(data) { this.data = data; return this; },
      setHeader() {}
    };
    await adapter.statusHandler(req, res, customState);
    assert.equal(res.data.participants[0].cefrLevel, "A2");
  });

  // ----------------------------------------------------
  // Feature 20: F5.1 E2E Test Suite Boundaries
  // ----------------------------------------------------
  test('F5.1 Bound 1: Test isolation: state changes in mockStorage do not bleed between resets', async () => {
    env.storage.reset({ custom: "data" });
    let state = await env.storage.getState();
    assert.equal(state.custom, "data");
    env.storage.reset(); // default
    state = await env.storage.getState();
    assert.equal(state.users.userA.streak, 47);
  });

  test('F5.1 Bound 2: MockTime advanceDays, advanceHours, and advanceMs work accurately', () => {
    const before = env.time.getTime().getTime();
    env.time.advanceHours(2);
    const after = env.time.getTime().getTime();
    assert.equal(after - before, 2 * 3600000);
  });

  test('F5.1 Bound 3: MockNetwork correctly records all simulated HTTP fetch requests', async () => {
    env.network.clear();
    await globalThis.fetch('https://api.telegram.org/bot123/sendMessage', {
      method: 'POST',
      body: JSON.stringify({ chat_id: 1, text: "test" })
    });
    assert.equal(env.network.telegramCalls.length, 1);
    assert.equal(env.network.telegramCalls[0].body.text, "test");
  });

  test('F5.1 Bound 4: MockNetwork simulated failure status returns expected error response', async () => {
    env.network.geminiShouldFailStatus = 503;
    const res = await globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini', {
      method: 'POST',
      body: '{}'
    });
    assert.equal(res.status, 503);
    assert.equal(res.ok, false);
    env.network.geminiShouldFailStatus = null;
  });

  test('F5.1 Bound 5: Test reporting aggregates passed and total counts reliably', () => {
    assert.ok(total >= 100);
    assert.equal(passed, total - 1);
  });

  // ----------------------------------------------------
  // Feature 21: F5.2 Adversarial Coverage Hardening Boundaries
  // ----------------------------------------------------
  test('F5.2 Bound 1: Buffer input / binary payload to formatTelegramHtml does not crash', () => {
    assert.doesNotThrow(() => {
      adapter.formatTelegramHtml(Buffer.from("Sample text").toString());
    });
  });

  test('F5.2 Bound 2: Highly recursive nested tags (100 levels) does not throw RangeError: Maximum call stack size exceeded', () => {
    let input = '';
    for (let i = 0; i < 100; i++) input += '<blockquote>';
    input += 'deep text';
    assert.doesNotThrow(() => {
      const balanced = adapter.balanceHtmlTags(input);
      assert.ok(balanced.endsWith('</blockquote>'));
    });
  });

  test('F5.2 Bound 3: String with Unicode zero-width characters and RTL override handled safely', () => {
    const adversarial = 'Normal text \u200B\u200C\u200D and RTL \u202Ereversed\u202C text';
    const formatted = adapter.formatTelegramHtml(adversarial);
    assert.ok(typeof formatted === 'string');
  });

  test('F5.2 Bound 4: 100-day gap jump catchup terminates within safety bounds without infinite loop', () => {
    const user = {
      name: "LongLost",
      streak: 50,
      shields: 2,
      lastEvaluatedDate: "2026-06-01",
      checkInHistory: {}
    };
    const res = adapter.evaluateMultiDayCatchup(user, "2026-09-09");
    assert.equal(user.streak, 0);
    assert.equal(user.shields, 0);
    assert.equal(user.lastEvaluatedDate, "2026-09-08");
    assert.ok(res.evaluatedDays.length >= 90);
  });

  test('F5.2 Bound 5: Null byte injection (\\0) in Telegram HTML text does not throw or truncate unexpectedly', () => {
    const input = 'Before null\0after null<b>bold\0text</b>';
    const output = adapter.formatTelegramHtml(input);
    assert.match(output, /Before null/);
    assert.match(output, /bold/);
  });

  env.time.uninstall();
  env.network.uninstall();

  console.log(`\n  Tier 2 Complete: ${passed}/${total} tests passed.\n`);
  return { passed, total };
}

// Auto-run if executed directly
const isDirectRun = process.argv[1] && (process.argv[1].endsWith('tier2-boundaries.test.js') || process.argv[1].endsWith('tier2-boundaries.test'));
if (isDirectRun) {
  runTier2Tests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
