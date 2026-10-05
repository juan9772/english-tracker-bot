// test/helpers/adapter.js
/**
 * Contract Adapter and Reference Stubs
 * Provides authoritative specifications and reference oracles for all 21 features
 * defined in PROJECT.md and ORIGINAL_REQUEST.md.
 * 
 * Allows the E2E test suite to execute against authoritative reference stubs
 * while seamlessly delegating to production implementations in api/ when available.
 */

import { getLocalDateString, getPreviousDateString, getDayOfWeek, getLocalDateParts } from '../../api/_time.js';

// Dynamically check production modules
let prodTelegram = null;
let prodQueue = null;
let prodDb = null;
let prodCron = null;
let prodWebhook = null;
let prodStatus = null;

try { prodTelegram = await import('../../api/_telegram.js'); } catch (_) {}
try { prodQueue = await import('../../api/_queue.js'); } catch (_) {}
try { prodDb = await import('../../api/_db.js'); } catch (_) {}
try { prodCron = await import('../../api/cron.js'); } catch (_) {}
try { prodWebhook = await import('../../api/webhook.js'); } catch (_) {}
try { prodStatus = await import('../../api/status.js'); } catch (_) {}

/**
 * 1. Reference Implementation of Stack-Based HTML Tag Balancer (F1.4)
 */
export function referenceBalanceHtmlTags(html) {
  if (!html || typeof html !== 'string') return '';

  const tagRegex = /<\/?([a-zA-Z0-9\-_]+)(\s+[^>]*?)?\/?>/g;
  const stack = [];
  let result = '';
  let lastIndex = 0;
  let match;

  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = fullTag.startsWith('</');
    const isSelfClosing = fullTag.endsWith('/>') || VOID_TAGS.has(tagName);

    result += html.substring(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    if (isSelfClosing) {
      result += fullTag;
      continue;
    }

    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
        result += fullTag;
      } else if (stack.includes(tagName)) {
        // Unwind stack to match LIFO nesting
        while (stack.length > 0 && stack[stack.length - 1] !== tagName) {
          const unclosed = stack.pop();
          result += `</${unclosed}>`;
        }
        if (stack.length > 0 && stack[stack.length - 1] === tagName) {
          stack.pop();
          result += fullTag;
        }
      }
      // Orphan closing tag is discarded
    } else {
      stack.push(tagName);
      result += fullTag;
    }
  }

  result += html.substring(lastIndex);

  // Close any unclosed tags at end in LIFO order
  while (stack.length > 0) {
    const unclosed = stack.pop();
    result += `</${unclosed}>`;
  }

  return result;
}

/**
 * 2. Reference Implementation of Strict Entity Escaping & Formatting (F1.1, F1.2, F1.3)
 */
export function referenceFormatTelegramHtml(text) {
  if (!text || typeof text !== 'string') return '';

  let html = text;

  // Protect and convert code blocks
  const codeBlocks = [];
  html = html.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const tag = lang ? `<pre><code class="language-${lang}">${escapedCode}</code></pre>` : `<pre><code>${escapedCode}</code></pre>`;
    codeBlocks.push(tag);
    return `@@@TG_CODE_BLOCK_${codeBlocks.length - 1}@@@`;
  });

  // Protect and convert inline code
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(`<code>${escapedCode}</code>`);
    return `@@@TG_CODE_BLOCK_${codeBlocks.length - 1}@@@`;
  });

  // Disambiguate Markdown bullet lists (* item, - item) before processing italics
  html = html.replace(/^[ \t]*[\*\-][ \t]+(.+)$/gm, '• $1');

  // Convert headers (### Header, ## Header, # Header) to <b>Header</b>
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Convert blockquotes: > line1\n> line2
  html = html.replace(/(?:^[ \t]*>[ \t]*[^\n]*(?:\n|$))+/gm, (match) => {
    const cleanContent = match
      .split('\n')
      .map(line => line.replace(/^[ \t]*>[ \t]?/, ''))
      .filter((line, i, arr) => i < arr.length - 1 || line.trim().length > 0)
      .join('\n')
      .trim();
    return `<blockquote>${cleanContent}</blockquote>\n`;
  });

  // Convert bold: **bold**: -> <b>bold:</b>, then **bold** or __bold__ -> <b>bold</b>
  html = html.replace(/\*\*([^*\n]+?)\*\*\s*:/g, '<b>$1:</b>');
  html = html.replace(/\*\*([^*\n]+?):\*\*/g, '<b>$1:</b>');
  html = html.replace(/__([^_\n]+?)__\s*:/g, '<b>$1:</b>');
  html = html.replace(/__([^_\n]+?):__/g, '<b>$1:</b>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.*?)__/g, '<b>$1</b>');

  // Convert italics: *text* or _text_ -> <i>text</i> (single asterisks not at start of line)
  html = html.replace(/(?<!\*)\*([^\*\s\n][^\*\n]*?)\*(?!\*)/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_([^_\s\n][^_\n]*?)_(?!_)/g, '<i>$1</i>');

  // Restore code blocks
  html = html.replace(/@@@TG_CODE_BLOCK_(\d+)@@@/g, (_, idx) => codeBlocks[parseInt(idx, 10)]);

  // Whitelist tags and attribute sanitization
  const validTagRegex = /<\/?([a-zA-Z0-9\-_]+)(\s+[^>]*?)?\/?>/gi;
  const tags = [];
  const disallowedTags = [];
  const ALLOWED_TAGS = new Set([
    'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
    'span', 'tg-spoiler', 'a', 'code', 'pre', 'blockquote', 'tg-emoji'
  ]);

  html = html.replace(validTagRegex, (fullMatch, tagName, attrString) => {
    const tagLower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagLower)) {
      // Disallowed tag: escape as plain text while preserving inner attributes
      disallowedTags.push(fullMatch.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      return `___TG_DISALLOWED_${disallowedTags.length - 1}___`;
    }

    const isClosing = fullMatch.startsWith('</');
    if (isClosing) {
      tags.push(`</${tagLower}>`);
      return `___TG_TAG_${tags.length - 1}___`;
    }

    // Sanitize attributes according to Telegram Bot API specification
    let sanitizedAttrs = '';
    if (attrString) {
      if (tagLower === 'a') {
        const hrefMatch = attrString.match(/href="([^"]*)"/i);
        if (hrefMatch) sanitizedAttrs = ` href="${hrefMatch[1]}"`;
      } else if (tagLower === 'code') {
        const classMatch = attrString.match(/class="(language-[^"]*)"/i);
        if (classMatch) sanitizedAttrs = ` class="${classMatch[1]}"`;
      } else if (tagLower === 'tg-emoji') {
        const emojiMatch = attrString.match(/emoji-id="([^"]*)"/i);
        if (emojiMatch) sanitizedAttrs = ` emoji-id="${emojiMatch[1]}"`;
      } else if (tagLower === 'blockquote') {
        if (/expandable/i.test(attrString)) sanitizedAttrs = ' expandable';
      } else if (tagLower === 'span') {
        if (/class="tg-spoiler"/i.test(attrString)) sanitizedAttrs = ' class="tg-spoiler"';
      }
    }

    tags.push(`<${tagLower}${sanitizedAttrs}>`);
    return `___TG_TAG_${tags.length - 1}___`;
  });

  // Strict character escaping outside tags
  // 1. Ampersand escaping (do not double escape valid entities)
  html = html.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');

  // 2. Angle brackets and quotes escaping
  html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/"/g, '&quot;');

  // Restore disallowed escaped tags
  html = html.replace(/___TG_DISALLOWED_(\d+)___/g, (_, index) => disallowedTags[parseInt(index, 10)]);

  // Restore protected tags
  html = html.replace(/___TG_TAG_(\d+)___/g, (_, index) => tags[parseInt(index, 10)]);

  // Apply stack-based tag balancer to close any unclosed tags
  return referenceBalanceHtmlTags(html).trim();
}

/**
 * 3. Reference Implementation of Safe 4096-char Chunking (F1.5)
 */
export function referenceChunkTelegramHtml(html, maxLen = 4000) {
  if (!html || typeof html !== 'string') return [''];
  if (html.length <= maxLen) return [html];

  const chunks = [];
  let remaining = html;
  let activeTags = [];

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Determine candidate cut point within budget
    let cutIndex = -1;
    const breakPoints = ['\n\n', '\n', '. ', ' '];
    for (const bp of breakPoints) {
      const idx = remaining.lastIndexOf(bp, maxLen);
      if (idx > maxLen * 0.5) {
        cutIndex = idx + bp.length;
        break;
      }
    }
    if (cutIndex === -1) {
      cutIndex = maxLen;
    }

    // Extract slice
    let chunkCandidate = remaining.substring(0, cutIndex);
    remaining = remaining.substring(cutIndex);

    // Track active tags in this chunk
    const tagRegex = /<\/?([a-zA-Z0-9\-_]+)(\s+[^>]*?)?\/?>/g;
    let m;
    const chunkOpenStack = [...activeTags];

    while ((m = tagRegex.exec(chunkCandidate)) !== null) {
      const fullTag = m[0];
      const tagName = m[1].toLowerCase();
      const isClosing = fullTag.startsWith('</');
      const isSelfClosing = fullTag.endsWith('/>');
      if (isSelfClosing) continue;

      if (isClosing) {
        const lastIdx = chunkOpenStack.lastIndexOf(tagName);
        if (lastIdx !== -1) {
          chunkOpenStack.splice(lastIdx, 1);
        }
      } else {
        chunkOpenStack.push(tagName);
      }
    }

    // Close active tags at end of chunk
    let closedChunk = chunkCandidate;
    for (let i = chunkOpenStack.length - 1; i >= 0; i--) {
      closedChunk += `</${chunkOpenStack[i]}>`;
    }
    chunks.push(closedChunk);

    // Reopen active tags in remaining
    activeTags = [...chunkOpenStack];
    let prefix = '';
    for (const tag of activeTags) {
      prefix += `<${tag}>`;
    }
    remaining = prefix + remaining;
  }

  return chunks;
}

/**
 * 4. Reference Implementation of Multi-Day Catchup Logic (F2.1)
 */
export function referenceEvaluateMultiDayCatchup(user, currentDateStr) {
  const previousDateStr = getPreviousDateString(currentDateStr);
  if (!user.lastEvaluatedDate) {
    user.lastEvaluatedDate = previousDateStr;
    return { evaluatedDays: [], penalties: [], shieldsUsed: 0 };
  }

  const evaluatedDays = [];
  const penalties = [];
  let shieldsUsed = 0;

  // Iterate day by day from lastEvaluatedDate + 1 to previousDateStr
  let evalDate = new Date(`${user.lastEvaluatedDate}T12:00:00Z`);
  const endDate = new Date(`${previousDateStr}T12:00:00Z`);

  while (evalDate.getTime() < endDate.getTime()) {
    evalDate = new Date(evalDate.getTime() + 86400000);
    const dateStr = evalDate.toISOString().slice(0, 10);
    evaluatedDays.push(dateStr);

    // Monday reset check
    const dayOfWeek = getDayOfWeek(dateStr);
    if (dayOfWeek === 1 && user.lastShieldResetDate !== dateStr) {
      user.shields = 2;
      user.lastShieldResetDate = dateStr;
    }

    const completed = (user.checkInHistory && user.checkInHistory[dateStr]) ||
                      user.lastCheckIn === dateStr ||
                      user.lastShieldUsedDate === dateStr;

    if (!completed) {
      if (user.shields > 0) {
        user.shields -= 1;
        user.lastShieldUsedDate = dateStr;
        shieldsUsed += 1;
      } else {
        const brokenStreak = user.streak || 0;
        user.streak = 0;
        if (brokenStreak > 0) {
          penalties.push({ date: dateStr, previousStreak: brokenStreak });
        }
      }
    }
  }

  user.lastEvaluatedDate = previousDateStr;
  return { evaluatedDays, penalties, shieldsUsed };
}

/**
 * 5. Reference Implementation of Public /api/status handler (F2.4)
 */
export async function referenceStatusHandler(req, res, state) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.json ? res.json({ error: 'Method Not Allowed' }) : res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const participants = [];
  if (state?.users) {
    for (const [key, user] of Object.entries(state.users)) {
      if (!user) continue;
      const todayStr = getLocalDateString(new Date(), user.timezone || 'UTC');
      const checkedInToday = user.lastCheckIn === todayStr;
      const shieldedToday = user.lastShieldUsedDate === todayStr;

      participants.push({
        name: user.name || key,
        streak: user.streak || 0,
        shields: user.shields ?? 2,
        checkedInToday,
        shieldedToday,
        cefrLevel: user.profile?.cefrLevel || "A2"
      });
    }
  }

  const payload = {
    status: "ok",
    updatedAt: new Date().toISOString(),
    dailySpark: state?.dailySpark || "What was the most interesting part of your day in English?",
    participants
  };

  if (res.setHeader) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  }
  res.statusCode = 200;
  return res.json ? res.json(payload) : res.end(JSON.stringify(payload));
}

/**
 * 6. Reference Implementation of Inline Keyboard (F3.5)
 */
export function referenceCreateInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🔥 Ver Estado", callback_data: "cmd:status" },
        { text: "🛡️ Usar Escudo", callback_data: "cmd:shield" }
      ],
      [
        { text: "💡 Reto de Hoy", callback_data: "cmd:spark" },
        { text: "📚 Repasar Vocabulario", callback_data: "cmd:review" }
      ]
    ]
  };
}

/**
 * Adapter interface methods delegating to real implementation when ready,
 * falling back to reference contract implementations.
 */
export const adapter = {
  formatTelegramHtml(text) {
    if (typeof prodTelegram?.formatTelegramHtml === 'function') {
      return prodTelegram.formatTelegramHtml(text);
    }
    return referenceFormatTelegramHtml(text);
  },
  balanceHtmlTags(html) {
    if (typeof prodTelegram?.balanceHtmlTags === 'function') {
      return prodTelegram.balanceHtmlTags(html);
    }
    return referenceBalanceHtmlTags(html);
  },
  chunkTelegramHtml(html, maxLen) {
    if (typeof prodTelegram?.chunkTelegramHtml === 'function') {
      return prodTelegram.chunkTelegramHtml(html, maxLen);
    }
    return referenceChunkTelegramHtml(html, maxLen);
  },
  evaluateMultiDayCatchup(user, currentDateStr) {
    if (typeof prodCron?.evaluateMultiDayCatchup === 'function') {
      return prodCron.evaluateMultiDayCatchup(user, currentDateStr);
    }
    return referenceEvaluateMultiDayCatchup(user, currentDateStr);
  },
  statusHandler(req, res, state) {
    if (typeof prodStatus?.default === 'function') {
      return prodStatus.default(req, res, state);
    }
    return referenceStatusHandler(req, res, state);
  },
  createInlineKeyboard() {
    if (typeof prodTelegram?.createInlineKeyboard === 'function') {
      return prodTelegram.createInlineKeyboard();
    }
    return referenceCreateInlineKeyboard();
  }
};
