// test/helpers/mock-env.js
/**
 * Test Environment Harness
 * Provides offline mocks for:
 * - Upstash / Redis KV state storage
 * - Telegram Bot API HTTP endpoints (sendMessage, answerCallbackQuery, getFile, download)
 * - Google Gemini AI Multimodal HTTP endpoints
 * - System Clock / Time simulation
 */

export class MockStorage {
  constructor(initialData = null) {
    this.data = initialData ? JSON.parse(JSON.stringify(initialData)) : null;
  }

  getInitialState() {
    return {
      chatId: -100123456789,
      dailySpark: "What is one English habit you are proud of?",
      queue: [],
      users: {
        userA: {
          id: "11111",
          username: "juan_dev",
          name: "Juan",
          timezone: "America/Argentina/Buenos_Aires",
          streak: 47,
          shields: 2,
          lastCheckIn: null,
          lastShieldUsedDate: null,
          lastEvaluatedDate: "2026-10-01",
          lastShieldResetDate: "2026-09-28",
          checkInHistory: {
            "2026-10-01": true
          },
          profile: {
            cefrLevel: "B2",
            strengths: ["Complex sentences", "Rich vocabulary", "Natural idioms"],
            focusAreas: ["Preposition nuances", "Third-person agreement"],
            lastUpdated: "2026-10-01T20:00:00.000Z"
          },
          vocabulary: [
            {
              term: "call it a day",
              meaning: "to stop working on something",
              example: "Let's call it a day and continue tomorrow.",
              addedDate: "2026-10-01",
              reviewCount: 1
            }
          ]
        },
        userB: {
          id: "22222",
          username: "sister_francy",
          name: "Sister Francy",
          timezone: "America/Mexico_City",
          streak: 18,
          shields: 1,
          lastCheckIn: null,
          lastShieldUsedDate: null,
          lastEvaluatedDate: "2026-10-01",
          lastShieldResetDate: "2026-09-28",
          checkInHistory: {
            "2026-10-01": true
          },
          profile: {
            cefrLevel: "B1",
            strengths: ["Clear pronunciation", "Consistent daily rhythm"],
            focusAreas: ["Past tense irregulars", "Connector words"],
            lastUpdated: "2026-10-01T19:00:00.000Z"
          },
          vocabulary: [
            {
              term: "bite the bullet",
              meaning: "face a difficult situation with courage",
              example: "I decided to bite the bullet and practice speaking.",
              addedDate: "2026-10-01",
              reviewCount: 2
            }
          ]
        }
      }
    };
  }

  async getState() {
    if (!this.data) {
      this.data = this.getInitialState();
    }
    return JSON.parse(JSON.stringify(this.data));
  }

  async saveState(newState) {
    this.data = JSON.parse(JSON.stringify(newState));
  }

  reset(customState = null) {
    this.data = customState ? JSON.parse(JSON.stringify(customState)) : this.getInitialState();
  }
}

export class MockTime {
  constructor(initialIso = "2026-10-02T06:00:00.000Z") {
    this.currentDate = new Date(initialIso);
    this.realDate = Date;
  }

  install() {
    const self = this;
    class MockDateClass extends this.realDate {
      constructor(...args) {
        if (args.length === 0) {
          super(self.currentDate);
        } else {
          super(...args);
        }
      }
      static now() {
        return self.currentDate.getTime();
      }
    }
    globalThis.Date = MockDateClass;
  }

  uninstall() {
    globalThis.Date = this.realDate;
  }

  advanceDays(days) {
    this.currentDate = new this.realDate(this.currentDate.getTime() + days * 86400000);
  }

  advanceHours(hours) {
    this.currentDate = new this.realDate(this.currentDate.getTime() + hours * 3600000);
  }

  advanceMs(ms) {
    this.currentDate = new this.realDate(this.currentDate.getTime() + ms);
  }

  setTime(isoOrTimestamp) {
    this.currentDate = new this.realDate(isoOrTimestamp);
  }

  getTime() {
    return new this.realDate(this.currentDate.getTime());
  }
}

export class MockNetwork {
  constructor() {
    this.telegramCalls = [];
    this.geminiCalls = [];
    this.customFetchHandlers = [];
    this.originalFetch = globalThis.fetch;
    this.telegramShouldFailStatus = null;
    this.geminiShouldFailStatus = null;
  }

  install() {
    const self = this;
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || 'GET').toUpperCase();
      let body = {};
      if (options.body) {
        try {
          body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        } catch {
          body = options.body;
        }
      }

      // Allow custom handlers first
      for (const handler of self.customFetchHandlers) {
        const handled = await handler(urlStr, options, body);
        if (handled) return handled;
      }

      // Telegram Bot API Mock
      if (urlStr.includes('api.telegram.org')) {
        self.telegramCalls.push({ url: urlStr, method, body, timestamp: Date.now() });

        if (self.telegramShouldFailStatus) {
          const status = self.telegramShouldFailStatus;
          return {
            ok: false,
            status,
            text: async () => JSON.stringify({ ok: false, error_code: status, description: "Simulated Telegram Error" }),
            json: async () => ({ ok: false, error_code: status, description: "Simulated Telegram Error" })
          };
        }

        if (urlStr.includes('/getFile')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              result: {
                file_id: body.file_id || "mock_file_id",
                file_unique_id: "mock_unique_id",
                file_size: 12345,
                file_path: "voice/file_0.oga"
              }
            }),
            text: async () => JSON.stringify({ ok: true, result: { file_path: "voice/file_0.oga" } })
          };
        }

        if (urlStr.includes('/file/bot')) {
          // Binary audio download
          const mockAudioBuffer = Buffer.from("OggS_MOCK_OPUS_AUDIO_STREAM_DATA");
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'audio/ogg' }),
            arrayBuffer: async () => mockAudioBuffer.buffer,
            buffer: async () => mockAudioBuffer,
            text: async () => mockAudioBuffer.toString('base64')
          };
        }

        if (urlStr.includes('/answerCallbackQuery')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: true }),
            text: async () => JSON.stringify({ ok: true, result: true })
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 9999, date: Math.floor(Date.now() / 1000) } }),
          text: async () => JSON.stringify({ ok: true, result: { message_id: 9999 } })
        };
      }

      // Google Gemini API Mock
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        self.geminiCalls.push({ url: urlStr, method, body, timestamp: Date.now() });

        if (self.geminiShouldFailStatus) {
          const status = self.geminiShouldFailStatus;
          return {
            ok: false,
            status,
            text: async () => JSON.stringify({
              error: { code: status, message: `Simulated Gemini Error ${status}`, status: "UNAVAILABLE" }
            }),
            json: async () => ({
              error: { code: status, message: `Simulated Gemini Error ${status}`, status: "UNAVAILABLE" }
            })
          };
        }

        // Generate mock AI response
        const promptText = JSON.stringify(body);
        let intent = "done";
        let isEnglishValid = true;
        let transcription = "Today I learned how to structure complex English sentences.";
        let dynamicReply = "Excellent job! <b>Your sentence structure is very solid.</b>\n\n<blockquote>Today I learned how to structure complex English sentences.</blockquote>\n\n🧠 <b>Qué mejoraría de tu versión</b>\n1. Gramática y fluidez impecables.\n\nTu nivel estimado es B2. ¡A seguir con todo! 🚀";

        if (promptText.includes("/start") || promptText.includes("start")) {
          intent = "start";
          dynamicReply = "¡Hola! Bienvenidos a nuestro rincón de constancia en inglés. 🇬🇧";
        } else if (promptText.includes("/status") || promptText.includes("status") || promptText.includes("racha")) {
          intent = "status";
          dynamicReply = "Aquí tienes el estado de constancia del grupo:";
        } else if (promptText.includes("/shield") || promptText.includes("escudo")) {
          intent = "shield";
          dynamicReply = "🛡️ Escudo activado correctamente para hoy.";
        }

        const candidateJson = {
          intent,
          englishPhrase: "Today I practiced English speaking and listening.",
          isEnglishValid,
          transcription,
          pronunciationFeedback: "Good natural cadence, minor hesitation on multi-syllable transitions.",
          dynamicReply,
          vocabularyItem: {
            term: "hit the nail on the head",
            meaning: "to describe exactly what is causing a situation or problem",
            example: "Your grammar analysis hit the nail on the head."
          },
          learningProfileUpdate: {
            cefrLevel: "B2",
            strengths: ["Complex sentences", "Good intonation", "Natural phrasing"],
            focusAreas: ["Linking vowels", "Conditional tense precision"]
          }
        };

        const responsePayload = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(candidateJson)
                  }
                ]
              }
            }
          ]
        };

        return {
          ok: true,
          status: 200,
          json: async () => responsePayload,
          text: async () => JSON.stringify(responsePayload)
        };
      }

      // Default fallback
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '{"ok":true}'
      };
    };
  }

  uninstall() {
    globalThis.fetch = this.originalFetch;
  }

  clear() {
    this.telegramCalls = [];
    this.geminiCalls = [];
    this.customFetchHandlers = [];
    this.telegramShouldFailStatus = null;
    this.geminiShouldFailStatus = null;
  }
}

export function setupTestEnvironment() {
  process.env.MOCK_KV = 'true';
  process.env.TELEGRAM_BOT_TOKEN = 'mock_telegram_bot_token_12345';
  process.env.TELEGRAM_CHAT_ID = '-100123456789';
  process.env.GEMINI_API_KEY = 'mock_gemini_api_key_abcde';
  process.env.USER_A_USERNAME = 'juan_dev';
  process.env.USER_A_NAME = 'Juan';
  process.env.USER_A_ID = '11111';
  process.env.USER_B_USERNAME = 'sister_francy';
  process.env.USER_B_NAME = 'Sister Francy';
  process.env.USER_B_ID = '22222';

  const storage = new MockStorage();
  const time = new MockTime();
  const network = new MockNetwork();

  time.install();
  network.install();

  return { storage, time, network };
}
