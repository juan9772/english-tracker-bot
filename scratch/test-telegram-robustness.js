import assert from 'assert';
import {
  escapeHtml,
  unescapeHtml,
  stripHtmlToPlainText,
  balanceHtmlTags,
  formatTelegramHtml,
  splitTelegramMessage,
  sendTelegramMessage
} from '../api/_telegram.js';

process.env.TELEGRAM_BOT_TOKEN = 'test_mock_token_123';

console.log('🧪 Starting Telegram Robustness & Retry Test Suite...\n');

// -------------------------------------------------------------
// TEST 1: escapeHtml, unescapeHtml, stripHtmlToPlainText
// -------------------------------------------------------------
console.log('--- Test 1: HTML Escaping & Plaintext Utilities ---');
const rawInput = 'Tom & Jerry <friends> "cartoon"';
const escaped = escapeHtml(rawInput);
assert.strictEqual(escaped, 'Tom &amp; Jerry &lt;friends&gt; &quot;cartoon&quot;');
assert.strictEqual(unescapeHtml(escaped), rawInput);

const htmlWithTags = '<p>Hello <b>World</b>!<br><li>Item 1</li></p>';
const plain = stripHtmlToPlainText(htmlWithTags);
assert.strictEqual(plain, 'Hello World!\n\n• Item 1');
console.log('✅ Escaping and plaintext strip passed');

// -------------------------------------------------------------
// TEST 2: balanceHtmlTags
// -------------------------------------------------------------
console.log('\n--- Test 2: HTML Tag Balancer ---');

// Unclosed tags
const unclosed = '<b>Bold text with <i>nested unclosed italic';
const balancedUnclosed = balanceHtmlTags(unclosed);
assert.strictEqual(balancedUnclosed, '<b>Bold text with <i>nested unclosed italic</i></b>');

// Inverted tags: <b><i>text</b></i>
const inverted = '<b><i>Inverted tags</b></i>';
const balancedInverted = balanceHtmlTags(inverted);
assert.strictEqual(balancedInverted, '<b><i>Inverted tags</i></b>');

// Unsupported tags: <p>, <br>, <li>, <div>
const unsupported = '<div><h1>Title</h1><p>Paragraph 1<br>Paragraph 2</p><ul><li>First</li><li>Second</li></ul></div>';
const balancedUnsupported = balanceHtmlTags(unsupported);
assert(balancedUnsupported.includes('• First'), 'Bullet points converted from <li>');
assert(!balancedUnsupported.includes('<div>'), '<div> stripped');
assert(!balancedUnsupported.includes('<h1>'), '<h1> stripped');

// Allowed attributes preserved
const link = '<a href="https://example.com?a=1&b=2">Visit</a>';
const balancedLink = balanceHtmlTags(link);
assert.strictEqual(balancedLink, '<a href="https://example.com?a=1&amp;b=2">Visit</a>');

const expQuote = '<blockquote expandable>Long quote</blockquote>';
assert.strictEqual(balanceHtmlTags(expQuote), '<blockquote expandable>Long quote</blockquote>');

console.log('✅ HTML tag balancing passed');

// -------------------------------------------------------------
// TEST 3: formatTelegramHtml
// -------------------------------------------------------------
console.log('\n--- Test 3: Markdown & Entity Formatting ---');

// Markdown code blocks
const mdCodeBlock = '```javascript\nconst a = 1 < 2 && 3 > 2;\n```';
const formattedCode = formatTelegramHtml(mdCodeBlock);
assert(formattedCode.includes('<pre><code>const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2;\n</code></pre>'), 'Code block formatted with escaped content');

// Inline code
const inlineCode = 'Check `foo <bar> & baz` please.';
const formattedInline = formatTelegramHtml(inlineCode);
assert.strictEqual(formattedInline, 'Check <code>foo &lt;bar&gt; &amp; baz</code> please.');

// Strikethrough & Links
const mdOther = '~~wrong~~ and [Telegram](https://telegram.org)';
const formattedOther = formatTelegramHtml(mdOther);
assert.strictEqual(formattedOther, '<s>wrong</s> and <a href="https://telegram.org">Telegram</a>');

// Raw ampersands outside tags
const ampersands = 'Fish & Chips &amp; Rock & Roll';
const formattedAmp = formatTelegramHtml(ampersands);
assert.strictEqual(formattedAmp, 'Fish &amp; Chips &amp; Rock &amp; Roll');

// Raw < and > outside tags
const mathExpr = 'If x < 5 and y > 10, then OK';
const formattedMath = formatTelegramHtml(mathExpr);
assert.strictEqual(formattedMath, 'If x &lt; 5 and y &gt; 10, then OK');

console.log('✅ Markdown and entity formatting passed');

// -------------------------------------------------------------
// TEST 4: splitTelegramMessage (>4000 characters)
// -------------------------------------------------------------
console.log('\n--- Test 4: Message Chunking for Length Limit ---');

// Generate 6000 character string wrapped in blockquote and bold
const paragraph = 'This is a long sentence explaining English grammar in thorough detail. '.repeat(15);
const longText = `<blockquote><b>Header Section</b>\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}</blockquote>`;
assert(longText.length > 5000, `Text length is ${longText.length}`);

const chunks = splitTelegramMessage(longText, 3000);
assert(chunks.length >= 2, `Split into ${chunks.length} chunks`);

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  assert(chunk.length <= 3100, `Chunk ${i} length (${chunk.length}) within limit`);
  // Each chunk must be balanced HTML
  assert.strictEqual(balanceHtmlTags(chunk), chunk, `Chunk ${i} must have balanced tags`);
}

// Ensure the first chunk opens blockquote and finishes with closing tags
assert(chunks[0].startsWith('<blockquote>'), 'Chunk 0 starts with blockquote');
assert(chunks[0].endsWith('</blockquote>'), 'Chunk 0 closes blockquote');
// Ensure the second chunk re-opens blockquote
assert(chunks[1].startsWith('<blockquote>'), 'Chunk 1 re-opens blockquote');
assert(chunks[1].endsWith('</blockquote>'), 'Chunk 1 closes blockquote');

console.log('✅ Message splitting with tag continuity passed');

// -------------------------------------------------------------
// TEST 5: sendTelegramMessage Retry Logic (Up to 5 attempts)
// -------------------------------------------------------------
console.log('\n--- Test 5: Telegram Retry System (Up to 5 attempts) ---');

const originalFetch = globalThis.fetch;

// Case 5.1: Recovers from 2 network errors on attempt 3
let attemptCount = 0;
globalThis.fetch = async (url, options) => {
  attemptCount++;
  if (attemptCount < 3) {
    throw new Error('ETIMEDOUT: Connection reset by peer');
  }
  return {
    ok: true,
    status: 200,
    text: async () => '{"ok":true}'
  };
};

attemptCount = 0;
const sentNetwork = await sendTelegramMessage('12345', 'Hello resilient bot');
assert.strictEqual(sentNetwork, true, 'Succeeded after network retries');
assert.strictEqual(attemptCount, 3, 'Took exactly 3 attempts');
console.log('✅ Network error retry (attempt 3 success) passed');

// Case 5.2: Recovers from HTTP 500 & 503 on attempt 4
attemptCount = 0;
globalThis.fetch = async (url, options) => {
  attemptCount++;
  if (attemptCount === 1) return { ok: false, status: 500, text: async () => 'Internal Error' };
  if (attemptCount === 2) return { ok: false, status: 502, text: async () => 'Bad Gateway' };
  if (attemptCount === 3) return { ok: false, status: 503, text: async () => 'Service Unavailable' };
  return { ok: true, status: 200, text: async () => '{"ok":true}' };
};

const sent5xx = await sendTelegramMessage('12345', 'Hello 5xx test');
assert.strictEqual(sent5xx, true, 'Succeeded after 5xx retries');
assert.strictEqual(attemptCount, 4, 'Took exactly 4 attempts');
console.log('✅ 5xx error retry (attempt 4 success) passed');

// Case 5.3: HTTP 429 Rate Limit
attemptCount = 0;
globalThis.fetch = async (url, options) => {
  attemptCount++;
  if (attemptCount === 1) {
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ ok: false, parameters: { retry_after: 0.1 } })
    };
  }
  return { ok: true, status: 200, text: async () => '{"ok":true}' };
};

const sent429 = await sendTelegramMessage('12345', 'Hello rate limit test');
assert.strictEqual(sent429, true, 'Succeeded after 429 rate limit backoff');
assert.strictEqual(attemptCount, 2, 'Took exactly 2 attempts');
console.log('✅ 429 rate limit retry passed');

// Case 5.4: HTTP 400 Parse Error recovers via plaintext fallback
attemptCount = 0;
const receivedBodies = [];
globalThis.fetch = async (url, options) => {
  attemptCount++;
  const body = JSON.parse(options.body);
  receivedBodies.push(body);
  if (body.parse_mode === 'HTML') {
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ ok: false, description: "Bad Request: can't parse entities: Can't find end tag" })
    };
  }
  // When fallback to plain text (no parse_mode)
  return { ok: true, status: 200, text: async () => '{"ok":true}' };
};

const sentParse = await sendTelegramMessage('12345', '<b>Broken tag text');
assert.strictEqual(sentParse, true, 'Succeeded after fallback from parse error');
assert(receivedBodies.some(b => !b.parse_mode), 'Fell back to sending message without parse_mode');
console.log('✅ Parse error fallback passed');

// Case 5.5: Exceeds 5 attempts -> returns false
attemptCount = 0;
globalThis.fetch = async (url, options) => {
  attemptCount++;
  return { ok: false, status: 503, text: async () => 'Service Unavailable' };
};

const sentFailed = await sendTelegramMessage('12345', 'Will fail 5 times');
assert.strictEqual(sentFailed, false, 'Returns false when 5 attempts exhausted');
assert.strictEqual(attemptCount, 5, 'Tried exactly 5 times before giving up');
console.log('✅ Max 5 attempts threshold verified');

// Restore original fetch
globalThis.fetch = originalFetch;

console.log('\n🎉 ALL TELEGRAM ROBUSTNESS & RETRY TESTS PASSED!');
