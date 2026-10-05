import { getState } from './_db.js';
import { getLocalDateString } from './_time.js';

function respond(res, code, body) {
  if (typeof res?.status === 'function') {
    if (typeof body === 'object') return res.status(code).json(body);
    return res.status(code).send(body);
  }
  if (res) {
    res.statusCode = code;
    if (typeof body === 'object') {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Content-Type', 'application/json');
      }
      return typeof res.json === 'function' ? res.json(body) : res.end(JSON.stringify(body));
    }
    return res.end(String(body));
  }
}

/**
 * Public read-only endpoint returning sanitized streak and challenge metrics.
 * Strictly omits private credentials, chat IDs, tokens, and internal user IDs.
 */
export default async function handler(req, res, optionalState) {
  if (req.method && req.method !== 'GET') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'GET');
    }
    return respond(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const state = optionalState || await getState();
    const now = new Date();

    const participants = [];
    if (state?.users && typeof state.users === 'object') {
      for (const [key, user] of Object.entries(state.users)) {
        if (!user || typeof user !== 'object') continue;

        const timezone = user.timezone || 'UTC';
        const todayStr = getLocalDateString(now, timezone);

        const checkedInToday = user.lastCheckIn === todayStr ||
          (user.checkInHistory && (
            Array.isArray(user.checkInHistory)
              ? user.checkInHistory.includes(todayStr)
              : !!user.checkInHistory[todayStr]
          ));

        const shieldedToday = user.lastShieldUsedDate === todayStr ||
          (user.shieldHistory && (
            Array.isArray(user.shieldHistory)
              ? user.shieldHistory.includes(todayStr)
              : !!user.shieldHistory[todayStr]
          ));

        let todayStatus = 'pending';
        if (checkedInToday) todayStatus = 'completed';
        else if (shieldedToday) todayStatus = 'shielded';

        // Public sanitized participant record (NEVER include id, chatId, or tokens)
        participants.push({
          name: user.name || (key === 'userA' ? 'Juan' : key === 'userB' ? 'Sister Francy' : key),
          streak: typeof user.streak === 'number' ? user.streak : 0,
          shields: typeof user.shields === 'number' ? user.shields : 2,
          checkedInToday: !!checkedInToday,
          shieldedToday: !!shieldedToday,
          todayStatus,
          cefrLevel: user.profile?.cefrLevel || (key === 'userA' ? 'B2' : 'B1')
        });
      }
    }

    let dailySparkQuestion = "What is one English habit you are proud of?";
    if (typeof state?.dailySpark === 'string' && state.dailySpark.length > 5) {
      dailySparkQuestion = state.dailySpark;
    } else if (state?.dailySpark?.question && typeof state.dailySpark.question === 'string') {
      dailySparkQuestion = state.dailySpark.question;
    }

    const payload = {
      status: "ok",
      updatedAt: now.toISOString(),
      dailySpark: dailySparkQuestion,
      participants
    };

    if (typeof res?.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
    }

    return respond(res, 200, payload);
  } catch (err) {
    console.error('Error in /api/status handler:', err);
    return respond(res, 500, { error: 'Internal Server Error' });
  }
}
