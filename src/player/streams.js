/**
 * player/streams.js — Live Stream Detection & Room Names
 * 
 * Helpers for detecting which stream is playing, and resolving
 * room codes (e.g. "brrr-5") to human-readable names (e.g. "Bar").
 * 
 * Room names are fetched from the live-streams API and cached
 * in localStorage. The cache is merged (not replaced) so that
 * room names from previous seasons persist for historical log entries.
 */

import { byId, IDS } from '../core/dom.js';
import * as storage from '../core/storage.js';

const LIVE_STREAMS_API = 'https://api.fishtank.live/v1/live-streams';
const ROOM_CACHE_KEY = 'room-names';

// In-memory map: room ID → display name
let roomMap = {};

/**
 * Check if a live stream player is currently visible.
 * 
 * @returns {boolean}
 */
export function isPlayerOpen() {
  return !!byId(IDS.LIVE_STREAM_PLAYER);
}

/**
 * Get the live stream player element.
 * 
 * @returns {HTMLElement|null}
 */
export function getPlayerElement() {
  return byId(IDS.LIVE_STREAM_PLAYER);
}

/**
 * Fetch room names from the live-streams API and update the cache.
 * 
 * Merges new data into the existing cache so that names from
 * previous seasons are preserved (for old log entries).
 * 
 * Call once on startup. Non-blocking — if the API fails,
 * cached names are still available and raw codes are shown
 * for any uncached rooms.
 * 
 * @returns {Promise<void>}
 */
export function fetchRoomNames() {
  // Load cached names first so they're available immediately
  const cached = storage.get(ROOM_CACHE_KEY, {});
  roomMap = { ...cached };

  return fetch(LIVE_STREAMS_API)
    .then(r => r.json())
    .then(data => {
      const streams = data.liveStreams || [];
      for (const stream of streams) {
        if (stream.id && stream.name) {
          roomMap[stream.id] = stream.name;
        }
      }
      // Persist merged map (old + new names)
      storage.set(ROOM_CACHE_KEY, roomMap);
    })
    .catch(() => {
      // API failed — cached names are still in roomMap
    });
}

/**
 * Convert a room code like "brrr-5" to a human-readable name like "Bar".
 * 
 * Returns the original code if no match is found (API not loaded
 * yet, or room not in cache).
 * 
 * @param {string} code - Room ID from socket data (e.g. "brrr-5")
 * @returns {string} Human-readable room name
 */
export function roomName(code) {
  if (!code) return '?';
  return roomMap[code] || code;
}

/**
 * Get the full room map (for debugging or advanced use).
 * 
 * @returns {Object} Map of room ID → display name
 */
export function getRoomMap() {
  return { ...roomMap };
}
