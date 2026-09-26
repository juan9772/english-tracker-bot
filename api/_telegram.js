const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Escapes characters that have special meaning in HTML (&, <, >, ").
 * Safe for inserting user-provided text into Telegram HTML templates.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Unescapes standard HTML entities back into plain characters.
 */
export function unescapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * Strips all HTML tags and unescapes entities, producing clean plain text.
 */
export function stripHtmlToPlainText(html) {
  if (!html) return '';
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?p>/gi, '\n')
      .replace(/<li>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<[^>]*>/g, '')
  ).trim();
}

const ALLOWED_TAGS = new Set([
  'b', 'strong',
  'i', 'em',
  'u', 'ins',
  's', 'strike', 'del',
  'code', 'pre',
  'blockquote',
  'tg-spoiler',
  'a'
]);

/**
 * Normalizes and balances Telegram-compatible HTML tags.
 * Ensures that every opened tag is closed in proper nested order,
 * unsupported HTML tags are stripped or converted, and rogue closing tags are discarded.
 */
export function balanceHtmlTags(html) {
  if (!html) return '';

  const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)([\s\S]*?)>/g;
  let lastIndex = 0;
  let result = '';
  const stack = []; // Array of { name: string, fullOpenTag: string }
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const [fullMatch, isClosing, rawTagName, rawAttrs] = match;
    const tagName = rawTagName.toLowerCase();

    // Append text leading up to this tag
    result += html.substring(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    // Convert or discard unsupported tags
    if (!ALLOWED_TAGS.has(tagName)) {
      if (tagName === 'br') {
        result += '\n';
      } else if (tagName === 'p') {
        result += isClosing ? '\n' : '\n';
      } else if (tagName === 'li') {
        result += isClosing ? '' : '• ';
      }
      continue;
    }

    if (isClosing) {
      const indexInStack = stack.map(s => s.name).lastIndexOf(tagName);
      if (indexInStack !== -1) {
        // Close all tags that were opened after this tag in reverse order
        while (stack.length > indexInStack) {
          const popped = stack.pop();
          result += `</${popped.name}>`;
        }
      }
      // If tag was not in open stack, discard rogue closing tag
    } else {
      // Opening tag: preserve valid attributes (href for <a>, expandable for <blockquote>, class for <code>)
      let cleanAttrs = '';
      if (tagName === 'a') {
        const hrefMatch = rawAttrs.match(/href="([^"]*)"/i) || rawAttrs.match(/href='([^']*)'/i);
        if (hrefMatch) {
          cleanAttrs = ` href="${escapeHtml(unescapeHtml(hrefMatch[1]))}"`;
        }
      } else if (tagName === 'blockquote' && /expandable/i.test(rawAttrs)) {
        cleanAttrs = ' expandable';
      } else if ((tagName === 'code' || tagName === 'pre') && /class="/i.test(rawAttrs)) {
        const classMatch = rawAttrs.match(/class="([^"]*)"/i);
        if (classMatch) {
          cleanAttrs = ` class="${escapeHtml(unescapeHtml(classMatch[1]))}"`;
        }
      }

      const openTag = `<${tagName}${cleanAttrs}>`;
      result += openTag;
      stack.push({ name: tagName, fullOpenTag: openTag });
    }
  }

  // Append remaining text
  result += html.substring(lastIndex);

  // Close any tags still unclosed at the end
  while (stack.length > 0) {
    const popped = stack.pop();
    result += `</${popped.name}>`;
  }

  return result;
}

/**
 * Returns an array of tags that remain unclosed in the given HTML string.
 */
function getOpenTagsStack(html) {
  const tagRegex = /<(\/)?([a-zA-Z0-9_-]+)([\s\S]*?)>/g;
  const stack = [];
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const [, isClosing, rawName] = match;
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;

    if (isClosing) {
      const idx = stack.map(s => s.name).lastIndexOf(name);
      if (idx !== -1) {
        stack.splice(idx);
      }
    } else {
      stack.push({ name, fullOpenTag: match[0] });
    }
  }

  return stack;
}

/**
 * Converts Markdown formatting into Telegram-compatible HTML tags,
 * escapes raw entities (&, <, >), and balances tags.
 */
export function formatTelegramHtml(text) {
  if (!text) return '';

  let html = text.replace(/\r\n/g, '\n');

  // 1. Convert code blocks: ```lang?\ncode\n``` -> <pre><code>code</code></pre>
  html = html.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  });

  // 2. Convert inline code: `code` -> <code>code</code>
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // 3. Convert headers: ### Header, ## Header, # Header -> <b>Header</b>
  html = html.replace(/^#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>');

  // 4. Convert bold: **text** or __text__ -> <b>text</b>
  html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__([\s\S]*?)__/g, '<b>$1</b>');

  // 5. Convert italics: *text* -> <i>text</i> (if not surrounded by *) or _text_ -> <i>text</i>
  html = html.replace(/(?<!\*)\*([^\*\s][^\*]*?)\*(?!\*)/g, '<i>$1</i>');
  html = html.replace(/(?<![a-zA-Z0-9_])_([^_\s][^_]*?)_(?![a-zA-Z0-9_])/g, '<i>$1</i>');

  // 6. Convert strikethrough: ~~text~~ -> <s>text</s>
  html = html.replace(/~~([\s\S]*?)~~/g, '<s>$1</s>');

  // 7. Convert blockquotes: > line1\n> line2 -> <blockquote>line1\nline2</blockquote>
  html = html.replace(/(?:^[ \t]*>[ \t]*[^\n]*(?:\n|$))+/gm, (match) => {
    const cleanContent = match
      .split('\n')
      .map(line => line.replace(/^[ \t]*>[ \t]?/, ''))
      .join('\n')
      .trim();
    return `<blockquote>${cleanContent}</blockquote>\n`;
  });

  // 8. Convert markdown links: [text](url) -> <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2">$1</a>');

  // 9. Convert bullet lists at start of lines: * item or - item -> • item
  html = html.replace(/^[ \t]*[-*][ \t]+(.+)$/gm, '• $1');

  // 10. Protect valid Telegram HTML tags, then escape remaining raw &, <, >
  const validTagRegex = /<\/?(b|strong|i|em|code|pre|blockquote|s|strike|del|u|ins|tg-spoiler|a)(\s+[^>]*)?\/?>/gi;
  const tags = [];
  html = html.replace(validTagRegex, (tag) => {
    tags.push(tag);
    return `___TG_TAG_${tags.length - 1}___`;
  });

  // Escape raw ampersands not already part of valid entities
  html = html.replace(/&(?!(?:amp|lt|gt|quot);)/gi, '&amp;');

  // Escape any raw < and > left in text
  html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Restore protected tags
  html = html.replace(/___TG_TAG_(\d+)___/g, (_, index) => tags[parseInt(index, 10)]);

  // 11. Balance all tags to ensure strict well-formed Telegram HTML
  return balanceHtmlTags(html).trim();
}

/**
 * Finds a safe splitting index in an HTML string <= maxLength,
 * ensuring cuts do not happen inside an HTML tag (<...>) or entity (&...;).
 */
function findSafeSplitIndex(text, maxLen) {
  if (text.length <= maxLen) return text.length;

  const searchSlice = text.substring(0, maxLen);
  let candidate = -1;

  // 1. Paragraph boundary (\n\n)
  const pBreak = searchSlice.lastIndexOf('\n\n');
  if (pBreak > maxLen * 0.4) {
    candidate = pBreak + 2;
  } else {
    // 2. Line boundary (\n)
    const nlBreak = searchSlice.lastIndexOf('\n');
    if (nlBreak > maxLen * 0.5) {
      candidate = nlBreak + 1;
    } else {
      // 3. Sentence boundary (. / ! / ?)
      const sentenceMatch = searchSlice.match(/([.!?]\s+)(?![\s\S]*[.!?]\s+)/);
      if (sentenceMatch && sentenceMatch.index > maxLen * 0.6) {
        candidate = sentenceMatch.index + sentenceMatch[1].length;
      } else {
        // 4. Word boundary
        const spaceBreak = searchSlice.lastIndexOf(' ');
        if (spaceBreak > maxLen * 0.7) {
          candidate = spaceBreak + 1;
        } else {
          candidate = maxLen;
        }
      }
    }
  }

  // Verify candidate is not inside an HTML tag <...>
  const lastLt = text.lastIndexOf('<', candidate);
  const lastGt = text.lastIndexOf('>', candidate);
  if (lastLt > lastGt) {
    candidate = lastLt; // Cut before opening tag
  }

  // Verify candidate is not inside an HTML entity &...;
  const lastAmp = text.lastIndexOf('&', candidate);
  const lastSemi = text.lastIndexOf(';', candidate);
  if (lastAmp > lastSemi && candidate - lastAmp < 10) {
    candidate = lastAmp; // Cut before ampersand
  }

  return candidate > 0 ? candidate : maxLen;
}

/**
 * Splits a long Telegram message (>4000 characters) into clean chunks,
 * ensuring each chunk is <= maxLength, tags are closed before boundaries,
 * and reopened in the next chunk so formatting is never broken.
 */
export function splitTelegramMessage(text, maxLength = 4000) {
  if (!text) return [];
  if (text.length <= maxLength) {
    return [balanceHtmlTags(text)];
  }

  const chunks = [];
  let remaining = text;
  let carryOverOpenTags = [];

  while (remaining.length > 0) {
    // Build prefix from previously open tags
    const prefix = carryOverOpenTags.map(t => t.fullOpenTag).join('');
    // Reserve characters for prefix and closing tags
    const suffixReserve = carryOverOpenTags.map(t => `</${t.name}>`).join('').length + 50;
    const availableLen = Math.max(maxLength - prefix.length - suffixReserve, 500);

    let splitIndex = findSafeSplitIndex(remaining, availableLen);
    if (splitIndex >= remaining.length) {
      splitIndex = remaining.length;
    }

    const rawSlice = remaining.substring(0, splitIndex);
    remaining = remaining.substring(splitIndex).trimStart();

    // Check which tags are open in prefix + rawSlice
    const combined = prefix + rawSlice;
    const openTags = getOpenTagsStack(combined);

    // Close all open tags at the end of this chunk
    const closingSuffix = openTags.slice().reverse().map(t => `</${t.name}>`).join('');
    const balancedChunk = combined + closingSuffix;

    chunks.push(balancedChunk);
    carryOverOpenTags = openTags;
  }

  return chunks;
}

/**
 * Sends a message to a Telegram chat with automatic message splitting,
 * strict HTML tag balancing, and a resilient retry mechanism (up to 5 attempts)
 * with exponential backoff, rate-limit honoring (429), and parse error recovery.
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

  if (!text || !String(text).trim()) {
    return true;
  }

  const MAX_RETRIES = 5;
  const chunks = splitTelegramMessage(String(text));
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (let c = 0; c < chunks.length; c++) {
    let currentChunk = chunks[c];
    let parseMode = 'HTML';
    let chunkSuccess = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const payload = {
          chat_id: chatId,
          text: currentChunk
        };
        if (parseMode) {
          payload.parse_mode = parseMode;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          chunkSuccess = true;
          break;
        }

        const status = response.status;
        let errorData = null;
        let errorDescription = '';

        try {
          const rawErr = await response.text();
          try {
            errorData = JSON.parse(rawErr);
            errorDescription = errorData.description || rawErr;
          } catch {
            errorDescription = rawErr;
          }
        } catch {
          errorDescription = `HTTP Status ${status}`;
        }

        console.warn(`Telegram API error (chunk ${c + 1}/${chunks.length}, attempt ${attempt}/${MAX_RETRIES}, status ${status}):`, errorDescription);

        // 1. Rate Limit (HTTP 429)
        if (status === 429) {
          const retryAfterSec = errorData?.parameters?.retry_after || Math.min(attempt * 2, 5);
          const waitMs = Math.min(retryAfterSec * 1000, 10000);
          console.warn(`Telegram rate limit hit. Sleeping ${waitMs}ms before attempt ${attempt + 1}...`);
          await sleep(waitMs);
          continue;
        }

        // 2. Parse Error (HTTP 400 with "can't parse entities")
        if (status === 400 && /can't parse entities/i.test(errorDescription)) {
          if (attempt === 1) {
            console.warn('Re-balancing HTML tags for retry...');
            currentChunk = balanceHtmlTags(currentChunk);
          } else {
            console.warn('Falling back to clean plain text due to persistent Telegram entity parsing error...');
            parseMode = null;
            currentChunk = stripHtmlToPlainText(currentChunk);
          }
          await sleep(200 * attempt);
          continue;
        }

        // 3. Message Too Long (HTTP 400 with "message is too long")
        if (status === 400 && /message is too long/i.test(errorDescription)) {
          console.warn('Telegram reported message too long, recursively sub-splitting chunk...');
          const subChunks = splitTelegramMessage(currentChunk, 2000);
          let allSubsSucceeded = true;
          for (const sub of subChunks) {
            const subOk = await sendTelegramMessage(chatId, sub, options);
            if (!subOk) allSubsSucceeded = false;
          }
          chunkSuccess = allSubsSucceeded;
          break;
        }

        // 4. Non-retriable client errors (e.g. Chat not found, Bot blocked by user)
        if (status === 400 || status === 403) {
          console.error(`Telegram non-retriable error (${status}):`, errorDescription);
          return false;
        }

        // 5. Transient Server Errors (500, 502, 503, 504) or others: Exponential backoff
        if (attempt < MAX_RETRIES) {
          const backoffMs = Math.min(400 * Math.pow(2, attempt - 1), 4000);
          await sleep(backoffMs);
        }
      } catch (fetchErr) {
        console.error(`Network exception sending Telegram message (chunk ${c + 1}/${chunks.length}, attempt ${attempt}/${MAX_RETRIES}):`, fetchErr.message || fetchErr);
        if (attempt < MAX_RETRIES) {
          const backoffMs = Math.min(400 * Math.pow(2, attempt - 1), 4000);
          await sleep(backoffMs);
        }
      }
    }

    if (!chunkSuccess) {
      console.error(`Failed to send Telegram message chunk ${c + 1} after ${MAX_RETRIES} attempts.`);
      return false;
    }
  }

  return true;
}
