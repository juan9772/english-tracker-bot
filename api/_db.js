const KV_STATE_KEY = 'telegram_english_bot_state';

// In-memory mock storage for local testing
let mockState = null;
let kvClient = null;

async function getKvClient() {
  if (!kvClient) {
    const { kv } = await import('@vercel/kv');
    kvClient = kv;
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
    const state = await kv.get(KV_STATE_KEY);
    if (!state) {
      const initial = getInitialState();
      await kv.set(KV_STATE_KEY, initial);
      return initial;
    }
    return typeof state === 'string' ? JSON.parse(state) : state;
  } catch (err) {
    console.error('Error getting state from Vercel KV, returning initial state:', err);
    return getInitialState();
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
    await kv.set(KV_STATE_KEY, state);
  } catch (err) {
    console.error('Error saving state to Vercel KV:', err);
    throw err;
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
  const envAUser = (process.env.USER_A_USERNAME || '').toLowerCase();
  const envBUser = (process.env.USER_B_USERNAME || '').toLowerCase();
  
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
  
  return null;
}
