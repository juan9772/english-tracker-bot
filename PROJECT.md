# Project: Telegram English Tracker Bot

## Architecture
Telegram English Tracker Bot is a serverless habit-building and English pedagogy system hosted on Vercel Serverless Functions and backed by Upstash Redis KV and Google Gemini AI.

The architecture comprises:
1. **Telegram Ingestion & Response Pipeline (`api/webhook.js`, `api/_telegram.js`, `api/_queue.js`)**:
   - Ingests text, voice notes (`message.voice`), and inline button clicks (`callback_query`).
   - Uses strict placeholder escaping and a stack-based LIFO tag balancer for HTML formatting (`<b>`, `<i>`, `<code>`, `<blockquote>`).
   - Handles safe 4096-character chunking without breaking nested tags.
   - Dispatches audio voice notes to Gemini Multimodal for transcription and oral evaluation.
2. **Pedagogical AI Engine (`api/_gemini.js`)**:
   - Single-call multimodal evaluation prompt extracting:
     - /done completion verification & correction
     - Oral pronunciation & fluency feedback (for voice notes)
     - Compact CEFR profile (level, top 3 strengths, top 3 focus areas)
     - Daily vocabulary flashcard (idiom/collocation)
   - Zero extra API calls or token overhead on Vercel Free Tier.
3. **Core Habit & Timezone Scheduling Engine (`api/cron.js`, `api/_db.js`, `vercel.json`)**:
   - Single daily cron at 06:00 UTC (03:00 AM Argentina UTC-3, 00:00 AM Mexico UTC-6).
   - Retrospective multi-day catchup engine evaluating un-evaluated days sequentially from `lastEvaluatedDate + 1` to yesterday.
   - Sequential shield deduction and Monday reset logic.
   - Dynamic user scalability (`state.users`) with 100% preservation of Bro Juan (47) and Sister Francy (18).
4. **Public Metrics & Web Dashboard (`api/status.js`, `public/index.html`)**:
   - Public read-only GET `/api/status` exposing streaks, shields, and daily progress without private tokens/chat IDs.
   - Responsive dark-theme dashboard in `public/index.html` consuming `/api/status`.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | F1.1 Strict Entity Escaping | Escaping `&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;` outside HTML tags via protected token placeholders | M1 | R1 |
| 2 | F1.2 Whitelist Tag Enforcement | Whitelist `<b>`, `<i>`, `<code>`, `<s>`, `<u>`, `<tg-spoiler>`, `<a>`, `<pre>`, `<blockquote>`, `<tg-emoji>` and strip invalid attributes | M1 | R1 |
| 3 | F1.3 Markdown Bullet Disambiguation | Prevent `* bullet` from matching italics `*italic*` across multi-line lists | M1 | R1 |
| 4 | F1.4 Stack-based Tag Balancer | LIFO stack auto-closing unclosed tags and discarding orphan closers before sending | M1 | R1 |
| 5 | F1.5 Safe 4096-char Chunking | Tag-aware message chunking partitioning at semantic breaks without breaking tag hierarchy | M1 | R1 |
| 6 | F1.6 Non-destructive Error Handling | Eliminate destructive regex stripping (`/<[^>]*>/g`) on 400 Bad Request | M1 | R1 |
| 7 | F2.1 Multi-day Catchup Algorithm | Sequential day-by-day evaluation from `lastEvaluatedDate + 1` to `previousDateStr` with Monday shield resets | M2 | R2 |
| 8 | F2.2 Dual Timezone Sync at 06:00 UTC | Schedule cron at 06:00 UTC in `vercel.json` (03:00 AM Argentina, 00:00 AM Mexico) for 1-cron daily Vercel limit | M2 | R2 |
| 9 | F2.3 Dynamic Participant Scalability | Refactor `state.users` to open dictionary; preserve `userA` (streak 47) and `userB` (streak 18) | M2 | R2 |
| 10 | F2.4 Public `/api/status` Endpoint | Read-only JSON endpoint returning sanitized participant streaks, shields, and Daily Spark | M2 | R2 |
| 11 | F2.5 Public Web Dashboard | Responsive dark-theme frontend in `public/index.html` consuming `/api/status` | M2 | R2 |
| 12 | F3.1 Voice Note Speaking Practice | Ingestion of `msg.voice`, Telegram `getFile` download, Base64 conversion, Gemini multimodal `audio/ogg` evaluation | M3 | R3 (M1) |
| 13 | F3.2 Daily Spark Thematic Question | Automatic daily conversation prompt taxonomy to eliminate blank-page syndrome | M3 | R3 (M2) |
| 14 | F3.3 Streak Warning Alert | Proactive evening notification for users with pending check-in before daily cutoff | M3 | R3 (M3) |
| 15 | F3.4 Spaced Repetition Vocab & `/review` | Extract 1 idiom/collocation per practice into Redis bank; `/review` command to test recall | M3 | R3 (M4) |
| 16 | F3.5 Interactive Inline Keyboards | Telegram `InlineKeyboardMarkup` 2x2 grid (`[🔥 Ver Estado]`, `[🛡️ Usar Escudo]`, `[💡 Reto de Hoy]`, `[📚 Repasar Vocabulario]`) & callback query handling | M3 | R3 (M5) |
| 17 | F4.1 Compact Learning Profile Schema | Redis schema under `user.profile` (`cefrLevel`, `strengths` [max 3], `focusAreas` [max 3], `lastUpdated`) <500 bytes | M4 | R4 |
| 18 | F4.2 Single-Call Zero-Token Profiling | Extend `callGemini` `/done` prompt and schema to extract profile & vocab in single call | M4 | R4 |
| 19 | F4.3 Profile Integration & UI Display | Display CEFR level and focus areas in `/status` output, dashboard, and feedback | M4 | R4 |
| 20 | F5.1 E2E Test Suite (Tiers 1-4) | Comprehensive test suite (Feature, Boundary, Combinatorial, Real-World) with 100% pass | M5 | Acceptance Criteria |
| 21 | F5.2 Adversarial Coverage Hardening | Tier 5 white-box challenger stress tests against edge cases and parser limits | M5 | Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Robust HTML Parser & Tag Balancer | `api/_telegram.js`, `api/_queue.js` | None | DONE |
| M2 | Core Structural Items & Dashboard | `vercel.json`, `api/cron.js`, `api/_db.js`, `api/status.js`, `public/index.html` | None | DONE |
| M3 | UX & Pedagogy Enhancements | `api/webhook.js`, `api/_telegram.js`, `api/_gemini.js` | M1 | DONE |
| M4 | Smart Free Tier Learning Profile | `api/_gemini.js`, `api/_db.js`, `api/webhook.js` | M2, M3 | DONE |
| M5 | Final E2E Test Pass & Hardening | Full system integration (`npm test` 300/300 pass) | M1, M2, M3, M4, Test Track | DONE |

Parallel Track:
- **E2E Testing Track (`testing_orch_1`)**: STATUS: DONE (`TEST_INFRA.md`, `TEST_READY.md`, 286 E2E tests across Tiers 1-5 + 14 smoke tests = 300 tests passing 100%).

---

## Interface Contracts

### 1. Telegram HTML Formatter & Balancer (`api/_telegram.js`, `api/_queue.js`)
- `formatTelegramHtml(text: string): string`
  - Escapes `&` to `&amp;`, `<` to `&lt;`, `>` to `&gt;` outside whitelisted tags.
  - Converts Markdown (`**bold**` -> `<b>`, `*italic*` -> `<i>`, `> quote` -> `<blockquote>`, ````code```` -> `<pre><code>`).
  - Balances all tags so output is strictly well-formed HTML.
- `balanceHtmlTags(html: string): string`
  - Stack-based LIFO closure: auto-closes unclosed tags, discards orphaned closing tags.
- `chunkTelegramHtml(html: string, maxLen = 4000): string[]`
  - Partitions long text into valid HTML chunks, closing active tags at chunk end and reopening them at next chunk start.
- `sendTelegramMessage(chatId: string, text: string, options?: { replyMarkup?: object }): Promise<boolean>`
  - Sends chunked messages with optional `reply_markup`.

### 2. Storage & Dynamic User Schema (`api/_db.js`)
- `state.users`: `Record<string, User>`
- User object structure:
  ```typescript
  interface User {
    id: string;
    username: string;
    name: string;
    timezone: string;
    streak: number;
    shields: number;
    lastCheckIn: string | null;
    lastEvaluatedDate: string | null;
    lastShieldUsedDate: string | null;
    checkInHistory?: Record<string, boolean>;
    profile?: {
      cefrLevel: string; // "A1" | "A2" | "B1" | "B2" | "C1"
      strengths: string[]; // max 3 short strings
      focusAreas: string[]; // max 3 short strings
      lastUpdated: string; // ISO date
    };
    vocabulary?: Array<{
      term: string;
      meaning: string;
      example: string;
      addedDate: string;
      reviewCount: number;
    }>; // max 30 items
  }
  ```
- Compatibility rule: `userA` (`name: "Juan"`, `timezone: "America/Argentina/Buenos_Aires"`, streak 47) and `userB` (`name: "Sister"`, `timezone: "America/Mexico_City"`, streak 18) must never have their streaks reduced by unforced merges (`state.forceReset = true` required for valid streak penalties).

### 3. Public Status API (`api/status.js`)
- `GET /api/status`: Returns JSON:
  ```json
  {
    "status": "ok",
    "updatedAt": "2026-10-02T06:00:00.000Z",
    "dailySpark": "What is one habit you are proud of?",
    "participants": [
      {
        "name": "Juan",
        "streak": 47,
        "shields": 2,
        "checkedInToday": true,
        "cefrLevel": "B2"
      },
      {
        "name": "Sister Francy",
        "streak": 18,
        "shields": 1,
        "checkedInToday": false,
        "cefrLevel": "B1"
      }
    ]
  }
  ```
  Strict constraint: NEVER expose `id`, `chatId`, `telegramToken`, or sensitive personal info.

### 4. Multimodal Voice Note & Single-Call Gemini API (`api/_gemini.js`)
- `callGemini(promptText: string, audioBase64?: string): Promise<GeminiEvaluationResult>`
  - Ingests optional audio buffer (`audio/ogg`).
  - Response schema includes:
    ```typescript
    interface GeminiEvaluationResult {
      valid: boolean;
      transcription?: string; // for voice notes
      pronunciationFeedback?: string; // for voice notes
      feedbackHtml: string;
      vocabularyItem?: {
        term: string;
        meaning: string;
        example: string;
      };
      learningProfileUpdate?: {
        cefrLevel: string;
        strengths: string[];
        focusAreas: string[];
      };
    }
    ```

---

## Code Layout
- `api/_telegram.js`: Telegram API client, message chunker, tag balancer, inline keyboard utilities.
- `api/_queue.js`: HTML formatter, markdown-to-HTML parser, strict entity escaping.
- `api/_db.js`: Upstash Redis KV wrapper, dynamic user lookup and state persistence safeguard.
- `api/_gemini.js`: Gemini AI integration, multimodal audio handler, structured prompt & response schema.
- `api/cron.js`: 06:00 UTC daily cron handler, multi-day catchup engine, weekly shield reset.
- `api/webhook.js`: Telegram webhook entrypoint, text / voice / callback_query routing.
- `api/status.js`: Public read-only status endpoint.
- `public/index.html`: Public responsive dark-theme dashboard.
- `vercel.json`: Vercel routing rules and cron job definitions (`0 6 * * *`).
- `test/`: Comprehensive offline test suite (Tiers 1-5).
