/**
 * Telegram HTML Formatter, Balancer, and API Client
 */

export const SUPPORTED_TAGS = new Set([
  'b', 'strong',
  'i', 'em',
  'u', 'ins',
  's', 'strike', 'del',
  'span',
  'tg-spoiler',
  'a',
  'code',
  'pre',
  'blockquote',
  'tg-emoji'
]);

/**
 * Validates a single HTML tag according to Telegram Bot API specifications.
 * Returns parsed tag info if valid, or null if invalid/unsupported.
 */
export function parseTelegramTag(tagString) {
  if (!tagString || typeof tagString !== 'string') return null;

  const match = tagString.match(/^<\s*(\/)?\s*([a-zA-Z0-9_-]+)((?:\s+[^>]*)?)\s*>$/);
  if (!match) return null;

  const isClosing = !!match[1];
  const tagName = match[2].toLowerCase();
  const rawAttrs = (match[3] || '').trim();

  if (!SUPPORTED_TAGS.has(tagName)) {
    return null;
  }

  if (isClosing) {
    if (rawAttrs.length > 0) return null;
    return { isClosing: true, tagName, cleanTag: `</${tagName}>` };
  }

  // Tags that MUST NOT have any attributes (b, strong, i, em, u, ins, s, strike, del, tg-spoiler, pre)
  if (['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'tg-spoiler', 'pre'].includes(tagName)) {
    if (rawAttrs.length > 0) return null;
    return { isClosing: false, tagName, cleanTag: `<${tagName}>` };
  }

  if (tagName === 'span') {
    if (/class=["']tg-spoiler["']/i.test(rawAttrs)) {
      return { isClosing: false, tagName, cleanTag: '<span class="tg-spoiler">' };
    }
    return null;
  }

  if (tagName === 'a') {
    const hrefMatch = rawAttrs.match(/href=(["'])(.*?)\1/i);
    if (hrefMatch) {
      return { isClosing: false, tagName, cleanTag: `<a href="${hrefMatch[2]}">` };
    }
    return { isClosing: false, tagName, cleanTag: '<a>' };
  }

  if (tagName === 'code') {
    if (!rawAttrs) {
      return { isClosing: false, tagName, cleanTag: '<code>' };
    }
    const langMatch = rawAttrs.match(/class=(["'])language-([a-zA-Z0-9_-]+)\1/i);
    if (langMatch) {
      return { isClosing: false, tagName, cleanTag: `<code class="language-${langMatch[2]}">` };
    }
    if (/^[a-zA-Z0-9_-]+=/i.test(rawAttrs)) {
      return { isClosing: false, tagName, cleanTag: '<code>' };
    }
    return null;
  }

  if (tagName === 'blockquote') {
    if (!rawAttrs) {
      return { isClosing: false, tagName, cleanTag: '<blockquote>' };
    }
    if (/expandable/i.test(rawAttrs)) {
      return { isClosing: false, tagName, cleanTag: '<blockquote expandable>' };
    }
    if (/^[a-zA-Z0-9_-]+=/i.test(rawAttrs)) {
      return { isClosing: false, tagName, cleanTag: '<blockquote>' };
    }
    return null;
  }

  if (tagName === 'tg-emoji') {
    const emojiMatch = rawAttrs.match(/emoji-id=(["'])(.*?)\1/i);
    if (emojiMatch) {
      return { isClosing: false, tagName, cleanTag: `<tg-emoji emoji-id="${emojiMatch[2]}">` };
    }
    return null;
  }

  return null;
}

/**
 * Escapes reserved characters (&, <, >) outside of valid Telegram HTML tags.
 * Preserves already-valid named/numeric entities and supported tags.
 */
export function escapeTelegramHtml(text) {
  if (!text || typeof text !== 'string') return '';

  // 1. Tokenize valid entities (&amp;, &lt;, &gt;, &quot;, &#123;, &#x1F44D;)
  const entityPlaceholders = [];
  let tokenized = text.replace(/&(amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/g, (match) => {
    entityPlaceholders.push(match);
    return `___TG_ENT_${entityPlaceholders.length - 1}___`;
  });

  // 2. Tokenize valid Telegram HTML tags (without crossing line boundaries or swallowing other tags)
  const tagPlaceholders = [];
  const disallowedPlaceholders = [];
  const tagCandidateRegex = /<(?:\/\s*)?[a-zA-Z][a-zA-Z0-9_-]*(?:\s+[^>\r\n<]*)?>/g;
  tokenized = tokenized.replace(tagCandidateRegex, (match) => {
    const parsed = parseTelegramTag(match);
    if (parsed) {
      tagPlaceholders.push(parsed.cleanTag);
      return `___TG_TAG_${tagPlaceholders.length - 1}___`;
    }
    // Disallowed tag: escape < and > as &lt; and &gt; but preserve inner attributes
    const escapedTag = match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    disallowedPlaceholders.push(escapedTag);
    return `___TG_DISALLOWED_${disallowedPlaceholders.length - 1}___`;
  });

  // 3. Escape remaining reserved characters outside protected tokens
  tokenized = tokenized.replace(/&/g, '&amp;');
  tokenized = tokenized.replace(/</g, '&lt;');
  tokenized = tokenized.replace(/>/g, '&gt;');
  tokenized = tokenized.replace(/"/g, '&quot;');

  // 4. Restore disallowed escaped tags
  tokenized = tokenized.replace(/___TG_DISALLOWED_(\d+)___/g, (_, idx) => disallowedPlaceholders[parseInt(idx, 10)]);

  // 5. Restore valid tags
  tokenized = tokenized.replace(/___TG_TAG_(\d+)___/g, (_, idx) => tagPlaceholders[parseInt(idx, 10)]);

  // 6. Restore valid entities
  tokenized = tokenized.replace(/___TG_ENT_(\d+)___/g, (_, idx) => entityPlaceholders[parseInt(idx, 10)]);

  return tokenized;
}

function canonicalTag(name) {
  if (name === 'strong') return 'b';
  if (name === 'em') return 'i';
  if (name === 'ins') return 'u';
  if (name === 'strike' || name === 'del') return 's';
  return name;
}

/**
 * Stack-based LIFO HTML tag balancer.
 * Auto-closes unclosed tags in reverse order and discards orphan closing tags.
 */
export function balanceHtmlTags(html) {
  if (!html || typeof html !== 'string') return '';

  // First normalize void tags that Telegram does not support
  let sanitized = html.replace(/<br\s*\/?>/gi, '\n').replace(/<hr\s*\/?>/gi, '\n');

  // Escape any rogue or invalid brackets so all remaining tags are valid Telegram tags
  sanitized = escapeTelegramHtml(sanitized);

  // Scan and tokenize tags vs text
  const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)((?:\s+[^>]*)?)>/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(sanitized)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: sanitized.slice(lastIndex, match.index) });
    }
    const isClosing = !!match[1];
    const tagName = match[2].toLowerCase();
    const rawTag = match[0];
    tokens.push({ type: 'tag', isClosing, tagName, rawTag });
    lastIndex = match.index + rawTag.length;
  }
  if (lastIndex < sanitized.length) {
    tokens.push({ type: 'text', content: sanitized.slice(lastIndex) });
  }

  const stack = []; // array of { tagName, rawTag, canon }
  let result = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      result += token.content;
      continue;
    }

    const canon = canonicalTag(token.tagName);

    if (!token.isClosing) {
      stack.push({ tagName: token.tagName, rawTag: token.rawTag, canon });
      result += token.rawTag;
    } else {
      if (stack.length === 0) {
        // Orphan closing tag -> discard!
        continue;
      }

      const top = stack[stack.length - 1];
      if (top.canon === canon) {
        stack.pop();
        result += `</${top.tagName}>`;
      } else if (stack.some(item => item.canon === canon)) {
        // Mismatched nesting: close intermediate open tags in LIFO order
        while (stack.length > 0 && stack[stack.length - 1].canon !== canon) {
          const unclosed = stack.pop();
          result += `</${unclosed.tagName}>`;
        }
        if (stack.length > 0) {
          const matched = stack.pop();
          result += `</${matched.tagName}>`;
        }
      } else {
        // Orphan closing tag (not in stack) -> discard!
        continue;
      }
    }
  }

  // Auto-close any remaining unclosed tags in LIFO order
  while (stack.length > 0) {
    const unclosed = stack.pop();
    result += `</${unclosed.tagName}>`;
  }

  return result;
}

/**
 * Converts Markdown formatting to valid Telegram HTML tags, escapes reserved entities,
 * and balances tags with LIFO stack.
 */
export function formatTelegramHtml(text) {
  if (!text || typeof text !== 'string') return '';

  let html = text;

  // 1. Replace void/unsupported HTML tags
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<hr\s*\/?>/gi, '\n');

  // 2. Protect and convert code blocks
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

  // 3. Protect and convert inline code
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(`<code>${escapedCode}</code>`);
    return `@@@TG_CODE_BLOCK_${codeBlocks.length - 1}@@@`;
  });

  // 4. Convert markdown headers: # Header -> <b>Header</b>
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // 5. Prevent Markdown bullet collisions with italics: normalize bullets `* item` or `- item` to `• item`
  html = html.replace(/^([ \t]*)[\*\-][ \t]+(.+)$/gm, '$1• $2');

  // 6. Convert markdown blockquotes: > line
  html = html.replace(/(?:^[ \t]*>[ \t]*[^\n]*(?:\n|$))+/gm, (match) => {
    const cleanContent = match
      .split('\n')
      .map(line => line.replace(/^[ \t]*>[ \t]?/, ''))
      .join('\n')
      .trim();
    return cleanContent ? `<blockquote>${cleanContent}</blockquote>\n` : '';
  });

  // 7. Convert bold: **bold**: -> <b>bold:</b>, then **bold** or __bold__ -> <b>bold</b>
  html = html.replace(/\*\*([^*\n]+?)\*\*\s*:/g, '<b>$1:</b>');
  html = html.replace(/\*\*([^*\n]+?):\*\*/g, '<b>$1:</b>');
  html = html.replace(/__([^_\n]+?)__\s*:/g, '<b>$1:</b>');
  html = html.replace(/__([^_\n]+?):__/g, '<b>$1:</b>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.*?)__/g, '<b>$1</b>');

  // 8. Convert italics: *italic* or _italic_ -> <i>italic</i>
  html = html.replace(/(?<![\*\w])\*([^\*\s\n](?:[^\*\n]*?[^\*\s\n])?)\*(?![\*\w])/g, '<i>$1</i>');
  html = html.replace(/(?<![_\w])_([^_\s\n](?:[^_\n]*?[^_\s\n])?)_(?![_\w])/g, '<i>$1</i>');

  // 9. Restore code blocks
  html = html.replace(/@@@TG_CODE_BLOCK_(\d+)@@@/g, (_, idx) => codeBlocks[parseInt(idx, 10)]);

  // 10. Balance and strictly escape reserved characters
  return balanceHtmlTags(html).trim();
}

/**
 * Tag-aware chunking for Telegram messages.
 * Splits text exceeding maxLen at semantic boundaries (\n\n, \n, space)
 * without breaking tag hierarchy (closing open tags at chunk end, reopening at next chunk start).
 */
export function chunkTelegramHtml(html, maxLen = 4000) {
  if (!html || typeof html !== 'string') return [];
  if (html.length <= maxLen) {
    const balanced = balanceHtmlTags(html);
    return balanced ? [balanced] : [];
  }

  const chunks = [];
  let current = html;

  while (current.length > maxLen) {
    let splitIdx = -1;

    // Search backwards for semantic breaks within safe threshold (40% to 100% of maxLen)
    const minThreshold = Math.floor(maxLen * 0.4);

    const pBreak = current.lastIndexOf('\n\n', maxLen);
    if (pBreak >= minThreshold) {
      splitIdx = pBreak;
    } else {
      const lBreak = current.lastIndexOf('\n', maxLen);
      if (lBreak >= minThreshold) {
        splitIdx = lBreak;
      } else {
        const sBreak = current.lastIndexOf(' ', maxLen);
        if (sBreak >= minThreshold) {
          splitIdx = sBreak;
        } else {
          splitIdx = maxLen;
        }
      }
    }

    // Ensure splitIdx is not inside a tag <...> or entity &...;
    const preSlice = current.slice(0, splitIdx);
    const lastOpenTag = preSlice.lastIndexOf('<');
    const lastCloseTag = preSlice.lastIndexOf('>');
    if (lastOpenTag > lastCloseTag) {
      // splitIdx is inside a tag; split before the tag begins
      splitIdx = lastOpenTag;
    } else {
      const lastAmp = preSlice.lastIndexOf('&');
      const lastSemi = preSlice.lastIndexOf(';');
      if (lastAmp > lastSemi && (splitIdx - lastAmp) < 10) {
        // splitIdx is inside an entity; split before the ampersand
        splitIdx = lastAmp;
      }
    }

    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }

    function getOpenStack(slice) {
      const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)((?:\s+[^>]*)?)>/g;
      const stack = [];
      let match;
      while ((match = tagRegex.exec(slice)) !== null) {
        const isClosing = !!match[1];
        const tagName = match[2].toLowerCase();
        const rawTag = match[0];
        const canon = canonicalTag(tagName);

        if (!isClosing) {
          stack.push({ tagName, rawTag, canon });
        } else {
          if (stack.length > 0 && stack[stack.length - 1].canon === canon) {
            stack.pop();
          } else if (stack.some(item => item.canon === canon)) {
            while (stack.length > 0 && stack[stack.length - 1].canon !== canon) {
              stack.pop();
            }
            if (stack.length > 0) stack.pop();
          }
        }
      }
      return stack;
    }

    let openStack = getOpenStack(current.slice(0, splitIdx));
    let closingTags = '';
    for (let i = openStack.length - 1; i >= 0; i--) {
      closingTags += `</${openStack[i].tagName}>`;
    }

    // Budget closing tags so final chunk strictly satisfies <= maxLen
    if (splitIdx + closingTags.length > maxLen) {
      const budget = Math.max(1, maxLen - closingTags.length);
      let adjusted = -1;
      const breakPoints = ['\n\n', '\n', ' '];
      for (const bp of breakPoints) {
        const idx = current.lastIndexOf(bp, budget);
        if (idx > budget * 0.4) {
          adjusted = idx + (bp === ' ' ? 0 : bp.length);
          break;
        }
      }
      splitIdx = adjusted > 0 ? adjusted : budget;
      openStack = getOpenStack(current.slice(0, splitIdx));
      closingTags = '';
      for (let i = openStack.length - 1; i >= 0; i--) {
        closingTags += `</${openStack[i].tagName}>`;
      }
    }

    const rawChunk = current.slice(0, splitIdx);

    // Build synthetic reopening tags for the next chunk
    let reopeningTags = '';
    for (let i = 0; i < openStack.length; i++) {
      reopeningTags += openStack[i].rawTag;
    }

    const balancedChunk = balanceHtmlTags(rawChunk + closingTags);
    if (balancedChunk.trim().length > 0) {
      chunks.push(balancedChunk);
    }

    // Remaining string continues with reopening tags prepended
    const remainder = current.slice(splitIdx).replace(/^[\r\n]+/, '');
    current = reopeningTags + remainder;
  }

  if (current.trim().length > 0) {
    const finalChunk = balanceHtmlTags(current);
    if (finalChunk.trim().length > 0) {
      chunks.push(finalChunk);
    }
  }

  return chunks;
}

/**
 * Creates 2x2 interactive inline keyboard matrix for quick user actions.
 */
export function createInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔥 Ver Estado', callback_data: 'cmd:status' },
        { text: '🛡️ Usar Escudo', callback_data: 'cmd:shield' }
      ],
      [
        { text: '💡 Reto de Hoy', callback_data: 'cmd:spark' },
        { text: '📚 Repasar Vocabulario', callback_data: 'cmd:review' }
      ]
    ]
  };
}

/**
 * Sends a message to a Telegram chat with automatic HTML tag balancing,
 * tag-aware chunking for messages > 4000 chars, support for replyMarkup options,
 * and surgical non-destructive error recovery.
 */
export async function sendTelegramMessage(chatId, text, options = {}) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN environment variable is not defined.');
    return false;
  }

  if (!chatId) {
    console.warn('Cannot send Telegram message: chatId is empty.');
    return false;
  }

  if (!text || typeof text !== 'string') {
    return false;
  }

  const chunks = chunkTelegramHtml(text, 4000);
  if (chunks.length === 0) {
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const replyMarkup = options.reply_markup || options.replyMarkup;
  let allSuccess = true;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLastChunk = (i === chunks.length - 1);

    const payload = {
      chat_id: chatId,
      text: chunk,
      parse_mode: 'HTML'
    };

    if (isLastChunk && replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    if (options.disable_web_page_preview !== undefined) {
      payload.disable_web_page_preview = options.disable_web_page_preview;
    }

    try {
      let response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        console.error(`Telegram API error (status ${response.status}):`, errorMsg);

        // Surgical non-destructive recovery on HTTP 400
        if (response.status === 400) {
          console.warn('Attempting non-destructive HTML repair on Telegram 400...');
          const repaired = balanceHtmlTags(chunk);

          let retryResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              text: repaired
            })
          });

          if (!retryResponse.ok) {
            // Non-destructive fallback: escape entities without stripping text content
            const safeEscaped = chunk
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');

            retryResponse = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...payload,
                text: safeEscaped
              })
            });
          }

          if (!retryResponse.ok) {
            allSuccess = false;
          }
        } else {
          allSuccess = false;
        }
      }
    } catch (err) {
      console.error('Failed to connect to Telegram API:', err);
      allSuccess = false;
    }
  }

  return allSuccess;
}
