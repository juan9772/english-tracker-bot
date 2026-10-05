import { getLocalDateString } from './_time.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls Gemini Multimodal API with unified single-call prompt and schema.
 * Supports both text evaluation and oral voice notes (audioBase64 with mimeType 'audio/ogg').
 * Extracts: valid, transcription, pronunciationFeedback, feedbackHtml, vocabularyItem, and learningProfileUpdate.
 * Zero extra API calls, zero extra tokens on Vercel Free Tier.
 *
 * Polymorphic signatures supported:
 * 1. callGemini(user, text, state, isUserBActive, options)
 * 2. callGemini(promptText, options)
 */
export async function callGemini(arg1, arg2 = {}, maybeState = null, maybeIsUserBActive = false, maybeOptions = {}) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;

  let user = null;
  let text = '';
  let options = {};

  if (typeof arg1 === 'object' && arg1 !== null && (arg1.name || arg1.timezone || arg1.streak !== undefined)) {
    // Legacy / queue signature: (user, text, state, isUserBActive, options)
    user = arg1;
    if (typeof arg2 === 'string') {
      text = arg2;
      options = (typeof maybeOptions === 'object' && maybeOptions !== null ? maybeOptions : {}) || {};
    } else if (typeof arg2 === 'object' && arg2 !== null) {
      options = arg2;
      text = options.text || options.promptText || '';
    }
  } else {
    // Single-call / prompt signature: (promptText, options)
    text = typeof arg1 === 'string' ? arg1 : (arg1?.text || arg1?.promptText || '');
    options = (typeof arg2 === 'object' && arg2 !== null ? arg2 : {}) || {};
    user = options.user || null;
  }

  // Audio extraction
  let audioBase64 = null;
  const mimeType = options.mimeType || 'audio/ogg';

  if (options.audioBase64) {
    audioBase64 = typeof options.audioBase64 === 'string'
      ? options.audioBase64
      : Buffer.from(options.audioBase64).toString('base64');
  } else if (options.audioBuffer) {
    audioBase64 = Buffer.isBuffer(options.audioBuffer)
      ? options.audioBuffer.toString('base64')
      : Buffer.from(options.audioBuffer).toString('base64');
  } else if (options.data) {
    audioBase64 = typeof options.data === 'string'
      ? options.data
      : Buffer.from(options.data).toString('base64');
  }

  const defaultModels = [
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-1.5-flash',
    'gemini-2.0-flash'
  ];
  const envModel = (process.env.GEMINI_MODEL || '').trim();
  const modelsToTry = [...new Set([envModel, ...defaultModels].filter(Boolean))];

  const currentDateStr = user ? getLocalDateString(new Date(), user.timezone || 'America/Argentina/Buenos_Aires') : new Date().toISOString().slice(0, 10);
  const isAlreadyDone = user ? user.lastCheckIn === currentDateStr : false;
  const isAlreadyShielded = user ? user.lastShieldUsedDate === currentDateStr : false;

  const systemInstructionText = `
Eres "English Tracker Bot", un tutor de inglés nativo, empático, entusiasta y pedagógico en Telegram.
Registras la práctica diaria de inglés del estudiante (sea por texto o por nota de voz oral) y analizas su desempeño de forma profunda.

REGLAS DE EVALUACIÓN MULTIMODAL UNIFICADA:
1. Si se proporciona un audio (nota de voz):
   - Escucha con máxima atención el habla del estudiante.
   - En "transcription": transcribe exactamente y palabra por palabra lo que dijo en inglés.
   - En "valid" e "isEnglishValid": pon true si contiene inglés hablado inteligible con al menos 3 palabras. Pon false si es silencio, ruido ininteligible o español puro.
   - En "pronunciationFeedback": proporciona feedback fonético específico sobre articulación de vocales/consonantes (ej. /θ/ vs /s/, /v/ vs /b/), acentuación de palabras (word stress), ritmo y linking / connected speech.
   - En "intent": pon siempre "done" si es inglés válido.

2. Si se proporciona texto escrito:
   - En "valid" e "isEnglishValid": pon true si está en inglés, tiene >=10 caracteres y cierta coherencia. Si no, pon false.
   - Si contiene una frase o texto en inglés para check-in (>=10 caracteres), clasifícalo con "intent": "done".
   - Otros intents válidos si aplica: "start" (bienvenida), "shield" (escudo), "status" (consulta racha), "spark" (reto diario), "review" (repaso vocabulario), "chat" (conversación casual).

3. "feedbackHtml" y "dynamicReply":
   Proporciona una corrección pedagógica estructurada y de alta calidad en español rioplatense cálido, utilizando estrictamente formato HTML válido para Telegram (<b>, <i>, <code>, <blockquote>):
   - Si fue audio:
     🎙️ <b>Transcripción de tu audio:</b>\n<blockquote>"\${transcription}"</blockquote>\n\n
     🌟 <b>Versión Nativa y Fluida:</b>\n<blockquote>[Versión natural que mantenga la intención original]</blockquote>\n\n
     🧠 <b>Qué mejoraría de tu versión</b>\n
     🗣️ <b>Pronunciación y Fluidez:</b> [Consejos fonéticos concretos y accionables]\n
     ✍️ <b>Gramática y Vocabulario:</b> [Explicación clara de estructuras, preposiciones y colocaciones]\n\n
     📊 <b>Nivel Estimado:</b> [Comentario motivador sobre nivel CEFR].
   - Si fue texto:
     🌟 <b>Versión Nativa y Fluida:</b>\n<blockquote>[Versión natural]</blockquote>\n\n
     🧠 <b>Qué mejoraría de tu versión</b>\n
     1. [Puntos numerados explicando el porqué gramatical o de vocabulario]\n\n
     📊 <b>Nivel Estimado:</b> [Comentario motivador sobre nivel CEFR].

4. "vocabularyItem":
   Extrae exactamente 1 modismo, phrasal verb o colocación clave demostrada o recomendada en la práctica:
   - "term": término o expresión en inglés (ej. "call it a day", "hit the ground running", "overthink").
   - "meaning": significado claro y conciso en español.
   - "example": oración de ejemplo natural en inglés usándolo.

5. "learningProfileUpdate":
   Actualiza el perfil de aprendizaje del estudiante de forma compacta:
   - "cefrLevel": "A1" | "A2" | "B1" | "B2" | "C1".
   - "strengths": array con hasta 3 fortalezas demostradas (máximo 40 caracteres cada una).
   - "focusAreas": array con hasta 3 áreas prioritarias de mejora (máximo 40 caracteres cada una).
`;

  let userContext = '';
  if (user) {
    userContext = `
DATOS DEL USUARIO:
- Nombre: ${user.name}
- Racha actual: ${user.streak} días
- Escudos restantes: ${user.shields} / 2
- ¿Ya hizo check-in hoy? ${isAlreadyDone ? 'Sí' : 'No'}
- ¿Ya usó escudo hoy? ${isAlreadyShielded ? 'Sí' : 'No'}
- Fecha local del usuario: ${currentDateStr}
`;
  }

  const promptContent = `${userContext}
MENSAJE DEL USUARIO:
${audioBase64 ? '[El usuario envió una nota de voz adjunta en formato audio/ogg]' : `"${text}"`}
${text && audioBase64 ? `Contexto adicional: "${text}"` : ''}
`;

  // Build multimodal parts array
  const parts = [{ text: promptContent }];
  if (audioBase64) {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: audioBase64
      }
    });
  }

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstructionText }]
    },
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 3000,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          valid: {
            type: 'BOOLEAN',
            description: 'true if the practice is valid English and meets criteria'
          },
          intent: {
            type: 'STRING',
            enum: ['start', 'done', 'shield', 'status', 'chat', 'spark', 'review']
          },
          englishPhrase: { type: 'STRING' },
          isEnglishValid: { type: 'BOOLEAN' },
          transcription: {
            type: 'STRING',
            description: 'Verbatim English transcription of the user spoken voice note'
          },
          pronunciationFeedback: {
            type: 'STRING',
            description: 'Specific oral feedback on pronunciation, phonetics, intonation, and fluency'
          },
          pronunciationNotes: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Key pronunciation observations'
          },
          feedbackHtml: {
            type: 'STRING',
            description: 'Full structured pedagogical correction and feedback formatted in valid Telegram HTML'
          },
          dynamicReply: {
            type: 'STRING',
            description: 'Full structured pedagogical feedback in Telegram HTML format'
          },
          vocabularyItem: {
            type: 'OBJECT',
            properties: {
              term: { type: 'STRING' },
              meaning: { type: 'STRING' },
              example: { type: 'STRING' }
            },
            required: ['term', 'meaning', 'example']
          },
          learningProfileUpdate: {
            type: 'OBJECT',
            properties: {
              cefrLevel: {
                type: 'STRING',
                enum: ['A1', 'A2', 'B1', 'B2', 'C1']
              },
              strengths: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Max 3 concise demonstrated strengths'
              },
              focusAreas: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Max 3 high-priority improvement areas'
              }
            },
            required: ['cefrLevel', 'strengths', 'focusAreas']
          }
        },
        required: ['intent', 'dynamicReply']
      }
    }
  };

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          const data = await response.json();
          const rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawResult) {
            let cleanedText = rawResult.trim();
            if (cleanedText.startsWith('```json')) {
              cleanedText = cleanedText.slice(7).replace(/```$/, '').trim();
            } else if (cleanedText.startsWith('```')) {
              cleanedText = cleanedText.slice(3).replace(/```$/, '').trim();
            }
            const parsed = JSON.parse(cleanedText);

            const isValid = parsed.valid !== undefined
              ? Boolean(parsed.valid)
              : (parsed.isEnglishValid !== undefined ? Boolean(parsed.isEnglishValid) : (parsed.intent === 'done'));

            const transcription = parsed.transcription || parsed.englishPhrase || (audioBase64 ? 'Spoken English practice' : text);
            const pronunciation = parsed.pronunciationFeedback || (Array.isArray(parsed.pronunciationNotes) ? parsed.pronunciationNotes.join('. ') : '');
            const feedback = parsed.feedbackHtml || parsed.dynamicReply || '';
            const intent = parsed.intent || (isValid ? 'done' : 'chat');

            let vocabularyItem = null;
            if (parsed.vocabularyItem && typeof parsed.vocabularyItem === 'object' && parsed.vocabularyItem.term) {
              vocabularyItem = {
                term: String(parsed.vocabularyItem.term).trim(),
                meaning: String(parsed.vocabularyItem.meaning || '').trim(),
                example: String(parsed.vocabularyItem.example || '').trim()
              };
            }

            let learningProfileUpdate = null;
            if (parsed.learningProfileUpdate && typeof parsed.learningProfileUpdate === 'object') {
              const cefr = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(parsed.learningProfileUpdate.cefrLevel)
                ? parsed.learningProfileUpdate.cefrLevel
                : 'B1';
              const strengths = Array.isArray(parsed.learningProfileUpdate.strengths)
                ? parsed.learningProfileUpdate.strengths.map(s => String(s).trim()).filter(Boolean).slice(0, 3)
                : [];
              const focusAreas = Array.isArray(parsed.learningProfileUpdate.focusAreas)
                ? parsed.learningProfileUpdate.focusAreas.map(f => String(f).trim()).filter(Boolean).slice(0, 3)
                : [];
              learningProfileUpdate = {
                cefrLevel: cefr,
                strengths,
                focusAreas
              };
            }

            return {
              valid: isValid,
              isEnglishValid: isValid,
              intent,
              transcription,
              englishPhrase: transcription,
              pronunciationFeedback: pronunciation,
              pronunciationNotes: Array.isArray(parsed.pronunciationNotes) ? parsed.pronunciationNotes : (pronunciation ? [pronunciation] : []),
              feedbackHtml: feedback,
              dynamicReply: feedback,
              vocabularyItem,
              learningProfileUpdate
            };
          }
        }

        const status = response.status;
        const errText = await response.text();
        console.warn(`Gemini API error (model ${model}, attempt ${attempt}, status ${status}):`, errText);

        if (status === 404) {
          break; // Switch to next fallback model immediately if endpoint/model 404
        }

        // Retry transient errors (503, 429, 500, 502, 504)
        if ([503, 429, 500, 502, 504].includes(status) && attempt < 3) {
          const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
          await sleep(backoffMs);
          continue;
        }
      } catch (err) {
        console.error(`Fetch error connecting to Gemini API (model ${model}, attempt ${attempt}):`, err);
        if (attempt < 3) {
          await sleep(500 * attempt);
        }
      }
    }
  }

  return null;
}

/**
 * Dedicated helper to evaluate audio voice notes via Gemini Multimodal.
 * Ingests audio buffer or Base64 and returns transcription, oral feedback,
 * pedagogical correction, vocabulary flashcard, and CEFR profile update.
 */
export async function callGeminiAudio(audioData, options = {}) {
  let audioBase64 = '';
  let mimeType = options.mimeType || 'audio/ogg';

  if (typeof audioData === 'string') {
    audioBase64 = audioData;
  } else if (Buffer.isBuffer(audioData)) {
    audioBase64 = audioData.toString('base64');
  } else if (audioData && typeof audioData === 'object') {
    if (audioData.audioBase64) audioBase64 = audioData.audioBase64;
    else if (audioData.data) audioBase64 = audioData.data;
    else if (Buffer.isBuffer(audioData.buffer)) audioBase64 = audioData.buffer.toString('base64');
    if (audioData.mimeType) mimeType = audioData.mimeType;
  }

  const promptText = options.promptText || options.text || 'Evaluate English practice voice note and return structured pedagogical JSON.';
  return callGemini(promptText, { ...options, audioBase64, mimeType });
}
