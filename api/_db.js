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
    return typeof state === 'string' ? JSON.parse(state) : state;
  } catch (err) {
    console.error('Error getting state from Redis KV, falling back to initial state:', err);
    if (!mockState) mockState = getInitialState();
    return JSON.parse(JSON.stringify(mockState));
  }
}

/**
 * Persists the updated state back to Vercel KV or the mock state.
 */
export async function saveState(state) {
  if (process.env.MOCK_KV === 'true') {
    mockState = JSON.parse(JSON.stringify(state));
    return;
  }
  
  try {
    const kv = await getKvClient();
    if (!kv) {
      mockState = JSON.parse(JSON.stringify(state));
      return;
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
  mockState = JSON.parse(JSON.stringify(state));
}

/**
 * Generates the default initial state structure.
 */
export function getInitialState() {
  return {
    chatId: null,
    users: {
      userA: {
        id: null,
        username: null,
        name: process.env.USER_A_NAME || 'Usuario A',
        timezone: 'America/Argentina/Buenos_Aires',
        streak: 0,
        shields: 2,
        lastCheckIn: null,
        lastShieldUsedDate: null,
        lastEvaluatedDate: null,
        lastShieldResetDate: null
      },
      userB: {
        id: null,
        username: null,
        name: process.env.USER_B_NAME || 'Usuario B',
        timezone: 'America/Mexico_City',
        streak: 0,
        shields: 2,
        lastCheckIn: null,
        lastShieldUsedDate: null,
        lastEvaluatedDate: null,
        lastShieldResetDate: null
      }
    }
  };
}

/**
 * Matches a Telegram message's sender to a key ('userA' or 'userB') in our state.
 * Uses USER_A_USERNAME / USER_B_USERNAME env vars (or IDs if they were previously saved).
 */
export function findUserKey(state, msg) {
  if (!msg || !msg.from) return null;
  
  const fromId = msg.from.id.toString();
  const fromUsername = (msg.from.username || '').toLowerCase();
  
  // 1. Check if ID already matched in state
  if (state.users.userA.id === fromId) return 'userA';
  if (state.users.userB.id === fromId) return 'userB';
  
  // 2. Check if username matches env vars
  const envAUser = (process.env.USER_A_USERNAME || '').replace(/^@/, '').toLowerCase().trim();
  const envBUser = (process.env.USER_B_USERNAME || '').replace(/^@/, '').toLowerCase().trim();
  
  if (envAUser && fromUsername === envAUser) {
    return 'userA';
  }
  if (envBUser && fromUsername === envBUser) {
    return 'userB';
  }
  
  // 3. Fallback to check if ID matches env vars (if user knows their ID and set it in env)
  const envAId = process.env.USER_A_ID;
  const envBId = process.env.USER_B_ID;
  
  if (envAId && fromId === envAId) return 'userA';
  if (envBId && fromId === envBId) return 'userB';
  
  // 4. Auto-bind User B: If sender is not a bot, not User A, and User B isn't bound yet,
  // automatically register this sender as User B (ideal when User B doesn't have a Telegram @username)
  if (!msg.from.is_bot && !state.users.userB.id) {
    return 'userB';
  }

  return null;
}
