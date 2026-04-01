/**
 * chat/messages.js — Chat Message Interception (Normalised)
 *
 * Listens for chat messages, TTS, and SFX events via the SDK's
 * Socket.IO connection. Normalises raw socket data into clean,
 * consistent objects so consumers don't need to handle quirks
 * like array-wrapped messages, role flag priority, or mention
 * object formats.
 *
 * TTS and SFX events are deduplicated automatically — the socket
 * fires multiple times per event (status changes), so only the
 * first occurrence is delivered to callbacks.
 *
 * Socket listeners are registered lazily on the first callback
 * registration — no need to call startListening() manually.
 *
 * RAW DATA ACCESS:
 * Every normalised object includes a `raw` property containing
 * the original socket data for advanced use cases.
 */

import { on, EVENTS } from '../core/socket.js';

// ── Callback registries ─────────────────────────────────────────────

const messageCallbacks = new Set();
const ttsCallbacks = new Set();
const sfxCallbacks = new Set();

// ── Deduplication state ─────────────────────────────────────────────

const recentTtsIds = new Set();
const recentSfxKeys = new Set();
const DEDUP_CAP = 500;

/**
 * Add a key to a dedup set, evicting the oldest entry if over cap.
 * Returns true if the key is new, false if it was a duplicate.
 */
function dedupAdd(set, key) {
  if (set.has(key)) return false;
  set.add(key);
  if (set.size > DEDUP_CAP) {
    const first = set.values().next().value;
    set.delete(first);
  }
  return true;
}

// ── Lazy listener init ──────────────────────────────────────────────

let listenersStarted = false;

function ensureListening() {
  if (listenersStarted) return;
  listenersStarted = true;

  // Chat messages
  on(EVENTS.CHAT_MESSAGE, (data) => {
    const normalised = normaliseChat(data);
    if (!normalised) return;
    for (const cb of messageCallbacks) {
      try { cb(normalised); }
      catch (e) { console.error('[ftl-ext-sdk] Chat message callback error:', e); }
    }
  });

  // TTS — server sends tts:insert and/or tts:update (inconsistent,
  // likely tied to approval flow). Listen on both, dedup handles overlap.
  const ttsHandler = (data) => {
    const normalised = normaliseTts(data);
    if (!normalised) return;
    for (const cb of ttsCallbacks) {
      try { cb(normalised); }
      catch (e) { console.error('[ftl-ext-sdk] TTS callback error:', e); }
    }
  };
  on(EVENTS.TTS_INSERT, ttsHandler);
  on(EVENTS.TTS_UPDATE, ttsHandler);

  // SFX — same situation: server sends sfx:insert and/or sfx:update.
  const sfxHandler = (data) => {
    const normalised = normaliseSfx(data);
    if (!normalised) return;
    for (const cb of sfxCallbacks) {
      try { cb(normalised); }
      catch (e) { console.error('[ftl-ext-sdk] SFX callback error:', e); }
    }
  };
  on(EVENTS.SFX_INSERT, sfxHandler);
  on(EVENTS.SFX_UPDATE, sfxHandler);
}

// ── Normalisation: Chat ─────────────────────────────────────────────

/**
 * Normalise a raw chat:message socket event.
 *
 * Handles:
 * - Array unwrapping (socket delivers [{...}] not {...})
 * - Role priority: staff > mod > fish > grandMarshal > epic > null
 * - Avatar filename extraction from CDN URL
 * - Mention normalisation to [{displayName, userId}]
 */
function normaliseChat(data) {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw) return null;

  // Avatar: extract filename from full CDN URL
  // "https://cdn.fishtank.live/avatars/rchl.png" → "rchl.png"
  const photoURL = raw.user?.photoURL || '';
  const avatar = photoURL.split('/').pop() || null;

  // Role priority: staff > mod > fish > grandMarshal > epic > null
  const meta = raw.metadata || {};
  const role = meta.isAdmin ? 'staff'
      : meta.isMod ? 'mod'
          : meta.isFish ? 'fish'
              : meta.isGrandMarshall ? 'grandMarshal'
                  : meta.isEpic ? 'epic'
                      : null;

  // Normalise mentions to consistent [{displayName, userId}] shape
  // Raw data sends objects: {displayName, userId}
  // But could theoretically send strings, so handle both
  const rawMentions = raw.mentions || [];
  const mentions = rawMentions.map(m => {
    if (typeof m === 'string') return { displayName: m, userId: null };
    return { displayName: m.displayName || '', userId: m.userId || null };
  });

  return {
    username:    raw.user?.displayName || '???',
    message:     raw.message || '',
    role,
    colour:      raw.user?.customUsernameColor || null,
    avatar,
    clan:        raw.user?.clan || null,
    endorsement: raw.user?.endorsement || null,
    mentions,
    raw,
  };
}

// ── Normalisation: TTS ──────────────────────────────────────────────

/**
 * Normalise a raw tts:update socket event.
 * Deduplicates by TTS ID — the socket fires for each status change.
 */
function normaliseTts(data) {
  if (!data) return null;

  const ttsId = data.id || null;
  if (ttsId && !dedupAdd(recentTtsIds, ttsId)) return null;

  return {
    username: data.displayName || '???',
    message:  data.message || '',
    voice:    data.voice || '?',
    room:     data.room || '?',
    audioId:  ttsId,
    clanTag:  data.clanTag || null,
    raw:      data,
  };
}

// ── Normalisation: SFX ──────────────────────────────────────────────

/**
 * Normalise a raw sfx:update socket event.
 * Deduplicates by ID or composite key (username:sound:room).
 */
function normaliseSfx(data) {
  if (!data) return null;

  const sfxKey = data.id || `${data.displayName}:${data.sound || data.message}:${data.room}`;
  if (!dedupAdd(recentSfxKeys, sfxKey)) return null;

  // Extract audio filename from CDN URL for slim storage
  const sfxUrl = data.url || '';
  const audioFile = sfxUrl.split('/').pop() || null;

  return {
    username:  data.displayName || '???',
    message:   data.sound || data.message || '???',
    room:      data.room || '?',
    audioFile,
    clanTag:   data.clanTag || null,
    raw:       data,
  };
}

// ── Public API: callback registration ───────────────────────────────

/**
 * Register a callback for new chat messages.
 *
 * The callback receives a normalised message object:
 * {
 *   username: string,          // Display name
 *   message: string,           // Message text
 *   role: string|null,         // 'staff' | 'mod' | 'fish' | 'grandMarshal' | 'epic' | null
 *   colour: string|null,       // Custom username colour (hex)
 *   avatar: string|null,       // Avatar filename (e.g. "rchl.png")
 *   clan: string|null,         // Clan tag
 *   endorsement: string|null,  // Endorsement badge text
 *   mentions: Array<{displayName: string, userId: string|null}>,
 *   raw: Object,               // Original socket data
 * }
 *
 * @param {Function} callback - Called with the normalised message
 * @returns {Function} Unsubscribe function
 */
export function onMessage(callback) {
  ensureListening();
  messageCallbacks.add(callback);
  return () => messageCallbacks.delete(callback);
}

/**
 * Register a callback for TTS events (deduplicated).
 *
 * The callback receives a normalised TTS object:
 * {
 *   username: string,      // Display name of sender
 *   message: string,       // TTS message text
 *   voice: string,         // Voice name (e.g. "Brainrot")
 *   room: string,          // Room code (e.g. "brrr-5")
 *   audioId: string|null,  // TTS ID (for CDN audio URL)
 *   clanTag: string|null,  // Sender's clan tag
 *   raw: Object,           // Original socket data
 * }
 *
 * @param {Function} callback - Called with the normalised TTS object
 * @returns {Function} Unsubscribe function
 */
export function onTTS(callback) {
  ensureListening();
  ttsCallbacks.add(callback);
  return () => ttsCallbacks.delete(callback);
}

/**
 * Register a callback for SFX events (deduplicated).
 *
 * The callback receives a normalised SFX object:
 * {
 *   username: string,       // Display name of sender
 *   message: string,        // Sound name
 *   room: string,           // Room code
 *   audioFile: string|null, // Audio filename from CDN URL
 *   clanTag: string|null,   // Sender's clan tag
 *   raw: Object,            // Original socket data
 * }
 *
 * @param {Function} callback - Called with the normalised SFX object
 * @returns {Function} Unsubscribe function
 */
export function onSFX(callback) {
  ensureListening();
  sfxCallbacks.add(callback);
  return () => sfxCallbacks.delete(callback);
}

// ── Convenience functions ───────────────────────────────────────────
// These work on the normalised message objects returned by onMessage.

/**
 * Check if a normalised message is from a fish (contestant).
 */
export function isFishMessage(msg) {
  return msg?.role === 'fish';
}

/**
 * Check if a normalised message is from staff/admin.
 */
export function isStaffMessage(msg) {
  return msg?.role === 'staff';
}

/**
 * Check if a normalised message is from a mod.
 */
export function isModMessage(msg) {
  return msg?.role === 'mod';
}

/**
 * Check if a normalised message is a "happening" (item use, system event).
 */
export function isHappening(msg) {
  return msg?.raw?.user?.id === 'happening';
}

/**
 * Check if a normalised message mentions a specific username.
 *
 * @param {Object} msg - Normalised message from onMessage
 * @param {string} username - Username to check for (case-insensitive)
 * @returns {boolean}
 */
export function mentionsUser(msg, username) {
  if (!msg?.mentions || !username) return false;
  const lower = username.toLowerCase();
  return msg.mentions.some(m => m.displayName.toLowerCase() === lower);
}

// ── Deprecated ──────────────────────────────────────────────────────

/**
 * @deprecated Listeners now start automatically when callbacks are
 * registered. This function is a no-op kept for backwards compatibility.
 */
export function startListening() {
  ensureListening();
}