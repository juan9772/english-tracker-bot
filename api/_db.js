const KV_STATE_KEY = 'telegram_english_bot_state';

// In-memory mock storage for local testing
let mockState = null;
let kvClient = null;
let isIoRedis = false;

async function getKvClient() {
  if (!kvClient) {
    const redisUrl = (process.env.REDIS_URL || process.env.KV_URL || '').trim();
    const restUrl = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
    const restToken = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();

    if (redisUrl && (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://'))) {
      const { default: Redis } = await import('ioredis');
      kvClient = new Redis(redisUrl, {
        connectTimeout: 5000,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
      await kvClient.connect();
      isIoRedis = true;
    } else if (restUrl && restToken && !restUrl.includes('...')) {
      const { Redis } = await import('@upstash/redis');
      kvClient = new Redis({ url: restUrl, token: restToken });
      isIoRedis = false;
    } else {
      console.warn('Redis connection parameters missing in environment variables. Falling back to in-memory state.');
      return null;
    }
  }
  return kvClient;
}

/**
 * Returns a deep clone of the current state from Vercel KV or the mock state.
 */
export async function getState() {
  if (process.env.MOCK_KV === 'true') {
    if (!mockState) {
      mockState = getInitialState();
    }
    return JSON.parse(JSON.stringify(mockState));
  }
  
  try {
    const kv = await getKvClient();
    if (!kv) {
      if (!mockState) mockState = getInitialState();
      return JSON.parse(JSON.stringify(mockState));
    }
    const state = await kv.get(KV_STATE_KEY);
    if (!state) {
      const initial = getInitialState();
      await saveState(initial);
      return initial;
    }
    let parsed = typeof state === 'string' ? JSON.parse(state) : state;
    const RESET_MIGRATION_VERSION = '2026-10-04_streak_reset_v1';
    if (parsed && parsed.resetMigrationVersion !== RESET_MIGRATION_VERSION) {
      if (parsed.users && typeof parsed.users === 'object') {
        const { getLocalDateString, getPreviousDateString } = await import('./_time.js');
        const now = new Date();
        for (const [_, user] of Object.entries(parsed.users)) {
          if (!user || typeof user !== 'object') continue;
          user.streak = 0;
          user.shields = 2;
          user.lastCheckIn = null;
          user.lastShieldUsedDate = null;
          const userToday = getLocalDateString(now, user.timezone || 'America/Argentina/Buenos_Aires');
          user.lastEvaluatedDate = getPreviousDateString(userToday);
          user.lastShieldResetDate = userToday;
        }
      }
      parsed.resetMigrationVersion = RESET_MIGRATION_VERSION;
      parsed.forceReset = true;
      await saveState(parsed);
      delete parsed.forceReset;
    }
    return parsed;
  } catch (err) {
    console.error('Error getting state from Redis KV, falling back to initial state:', err);
    if (!mockState) mockState = getInitialState();
    return JSON.parse(JSON.stringify(mockState));
  }
}

/**
 * Helper to dynamically merge user records and safeguard streaks.
 */
function mergeUsersSafely(targetUsers, existingUsers, forceReset) {
  if (!existingUsers || typeof existingUsers !== 'object') return;
  
  for (const [key, existingUser] of Object.entries(existingUsers)) {
    if (!existingUser || typeof existingUser !== 'object') continue;
    
    if (!targetUsers[key]) {
      // Do not drop existing users that were not in incoming state
      targetUsers[key] = JSON.parse(JSON.stringify(existingUser));
    } else {
      const targetUser = targetUsers[key];
      if (!targetUser.id && existingUser.id) targetUser.id = existingUser.id;
      if (!targetUser.username && existingUser.username) targetUser.username = existingUser.username;
      if (!targetUser.name && existingUser.name) targetUser.name = existingUser.name;
      if (!targetUser.timezone && existingUser.timezone) targetUser.timezone = existingUser.timezone;
      if (!targetUser.profile && existingUser.profile) targetUser.profile = existingUser.profile;
      if (!targetUser.checkInHistory && existingUser.checkInHistory) targetUser.checkInHistory = existingUser.checkInHistory;
      if (!targetUser.shieldHistory && existingUser.shieldHistory) targetUser.shieldHistory = existingUser.shieldHistory;
      if (!targetUser.vocabulary && existingUser.vocabulary) targetUser.vocabulary = existingUser.vocabulary;
      
      // Streak protection: only allow decrease if forceReset flag is explicitly set
      if ((targetUser.streak || 0) < (existingUser.streak || 0) && !forceReset) {
        targetUser.streak = existingUser.streak;
      }
    }
  }
}

/**
 * Persists the updated state back to Vercel KV or the mock state.
 * Implements strict safeguards to prevent accidental wiping of user IDs, usernames, streaks, and chatId.
 */
export async function saveState(state) {
  if (process.env.MOCK_KV === 'true') {
    if (mockState && mockState.users) {
      if (!state.users) state.users = {};
      mergeUsersSafely(state.users, mockState.users, state.forceReset);
    }
    mockState = JSON.parse(JSON.stringify(state));
    return;
  }
  
  try {
    const kv = await getKvClient();
    if (!kv) {
      if (mockState && mockState.users) {
        if (!state.users) state.users = {};
        mergeUsersSafely(state.users, mockState.users, state.forceReset);
      }
      mockState = JSON.parse(JSON.stringify(state));
      return;
    }

    // Protection Safeguard: Merge with existing Redis state to prevent accidental wiping of user data or streaks
    try {
      const existingRaw = await kv.get(KV_STATE_KEY);
      if (existingRaw) {
        const existing = typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw;
        
        // Preserve chatId if present in Redis
        if (!state.chatId && existing.chatId) {
          state.chatId = existing.chatId;
        }

        // Preserve dailySpark if not set in incoming state
        if (!state.dailySpark && existing.dailySpark) {
          state.dailySpark = existing.dailySpark;
        }

        // Preserve resetMigrationVersion if present in Redis
        if (!state.resetMigrationVersion && existing.resetMigrationVersion) {
          state.resetMigrationVersion = existing.resetMigrationVersion;
        }

        // Dynamically merge all users while safeguarding streaks unless forceReset is set
        if (!state.users || typeof state.users !== 'object') {
          state.users = {};
        }
        mergeUsersSafely(state.users, existing.users, state.forceReset);
      }
    } catch (e) {
      console.warn('Non-fatal error reading current state for protection merge:', e);
    }

    if (isIoRedis) {
      await kv.set(KV_STATE_KEY, JSON.stringify(state));
    } else {
      await kv.set(KV_STATE_KEY, state);
    }
  } catch (err) {
    console.error('Error saving state to Redis KV:', err);
    mockState = JSON.parse(JSON.stringify(state));
  }
}

/**
 * Sets the mock state directly. Useful for unit testing.
 */
export function setMockState(state) {
  mockState = state ? JSON.parse(JSON.stringify(state)) : null;
}

/**
 * Returns an array of all active users in state with their key.
 */
export function getUsers(state) {
  if (!state || !state.users || typeof state.users !== 'object') return [];
  return Object.entries(state.users)
    .filter(([_, user]) => user && typeof user === 'object')
    .map(([key, user]) => ({ key, ...user }));
}

/**
 * Generates the default initial state structure.
 */
export function getInitialState() {
  return {
    chatId: null,
    dailySpark: "What is one English habit you are proud of?",
    users: {
      userA: {
        id: null,
        username: null,
        name: process.env.USER_A_NAME || 'Juan',
        timezone: 'America/Argentina/Buenos_Aires',
        streak: 0,
        shields: 2,
        lastCheckIn: null,
        lastShieldUsedDate: null,
        lastEvaluatedDate: null,
        lastShieldResetDate: null,
        checkInHistory: {},
        profile: {
          cefrLevel: 'B2',
          strengths: ['Natural phrasing', 'Abstract vocabulary', 'Complex subordinate clauses'],
          focusAreas: ['Preposition collocations', 'Third conditional inversion'],
          lastUpdated: new Date().toISOString().slice(0, 10)
        }
      },
      userB: {
        id: null,
        username: null,
        name: process.env.USER_B_NAME || 'Sister Francy',
        timezone: 'America/Mexico_City',
        streak: 0,
        shields: 2,
        lastCheckIn: null,
        lastShieldUsedDate: null,
        lastEvaluatedDate: null,
        lastShieldResetDate: null,
        checkInHistory: {},
        profile: {
          cefrLevel: 'B1',
          strengths: ['Clear expression', 'Past tense narrative'],
          focusAreas: ['Listen vs hear', 'Modal auxiliary nuances'],
          lastUpdated: new Date().toISOString().slice(0, 10)
        }
      }
    }
  };
}

/**
 * Robust user lookup supporting userA/userB and arbitrary dynamic users.
 */
export function findUserKey(state, msg) {
  if (!msg || !msg.from || !state || !state.users) return null;
  
  const fromId = msg.from.id ? msg.from.id.toString() : '';
  const fromUsername = (msg.from.username || '').toLowerCase().replace(/^@/, '').trim();

  // 1. Direct key match (e.g. if keyed by Telegram ID)
  if (fromId && state.users[fromId]) return fromId;

  // 2. Check if ID matches an existing user's .id property
  if (fromId) {
    for (const [key, user] of Object.entries(state.users)) {
      if (user?.id && user.id.toString() === fromId) {
        return key;
      }
    }
  }

  // 3. Check if username matches an existing user's .username property (case-insensitive)
  if (fromUsername) {
    for (const [key, user] of Object.entries(state.users)) {
      if (user?.username && user.username.toLowerCase().replace(/^@/, '').trim() === fromUsername) {
        return key;
      }
    }
  }

  // 4. Backward-compatible environment variable bindings
  const envAUser = (process.env.USER_A_USERNAME || '').replace(/^@/, '').toLowerCase().trim();
  const envBUser = (process.env.USER_B_USERNAME || '').replace(/^@/, '').toLowerCase().trim();
  if (envAUser && fromUsername === envAUser && state.users.userA) return 'userA';
  if (envBUser && fromUsername === envBUser && state.users.userB) return 'userB';

  const envAId = (process.env.USER_A_ID || '').trim();
  const envBId = (process.env.USER_B_ID || '').trim();
  if (envAId && fromId === envAId && state.users.userA) return 'userA';
  if (envBId && fromId === envBId && state.users.userB) return 'userB';

  // 5. Auto-bind User B (sister without username fallback)
  if (!msg.from.is_bot && state.users.userB && !state.users.userB.id) {
    return 'userB';
  }

  // 6. Dynamic registration for new group participants
  if (!msg.from.is_bot && fromId && process.env.ALLOW_DYNAMIC_USERS !== 'false') {
    const newKey = fromId;
    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || `User ${fromId}`;
    state.users[newKey] = {
      id: fromId,
      username: msg.from.username || null,
      name: fullName,
      timezone: process.env.DEFAULT_TIMEZONE || 'America/Argentina/Buenos_Aires',
      streak: 0,
      shields: 2,
      lastCheckIn: null,
      lastShieldUsedDate: null,
      lastEvaluatedDate: null,
      lastShieldResetDate: null,
      checkInHistory: {},
      profile: {
        cefrLevel: 'A2',
        strengths: ['Initial engagement'],
        focusAreas: ['Daily vocabulary consistency'],
        lastUpdated: new Date().toISOString().slice(0, 10)
      }
    };
    return newKey;
  }

  return null;
}
