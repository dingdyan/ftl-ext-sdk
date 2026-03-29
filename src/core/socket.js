/**
 * core/socket.js — Socket.IO Connection
 * 
 * Creates the SDK's own Socket.IO connection to the fishtank.live
 * WebSocket server. This is a clean, independent connection — it does
 * not modify or interfere with the site's own connection.
 * 
 * The server uses MessagePack (binary) encoding over Socket.IO v4.
 * 
 * Connection handshake sequence (discovered via frame inspection):
 * 1. Connect WebSocket with msgpack parser
 * 2. Socket.IO handshake (automatic)
 * 3. Server expects a token emission: { token: <JWT|null> }
 *    - null/empty = global chat only (unauthenticated)
 *    - JWT = full access including season pass rooms + account events
 * 4. Server responds with session IDs
 * 5. Client subscribes to chat:presence and presence
 * 6. Server sends chat:room ("Global"), presence counts
 * 7. Chat messages start flowing
 */

const SOCKET_URL = 'wss://ws.fishtank.live';

// Auth token cookie name used by the site (Supabase auth)
const AUTH_COOKIE_NAME = 'sb-wcsaaupukpdmqdjcgaoo-auth-token';

// Connection state
let socket = null;
let connected = false;
let authenticated = false;
let connectionPromise = null;

// Event listeners registered before connection is established
const pendingListeners = [];

// All registered listeners: eventName -> Set<callback>
const listeners = new Map();

/**
 * Known Socket.IO event names used by the site.
 * Discovered by inspecting WebSocket frames.
 */
export const EVENTS = {
  // Chat
  CHAT_MESSAGE: 'chat:message',
  CHAT_ROOM: 'chat:room',
  CHAT_PRESENCE: 'chat:presence',
  
  // TTS
  TTS_UPDATE: 'tts:update',
  
  // SFX
  SFX_INSERT: 'sfx:insert',
  SFX_UPDATE: 'sfx:update',
  
  // Items
  CRAFTING_RECIPE_LEARNED: 'items:crafting-recipe:learned',
  
  // Notifications (toast messages / admin announcements)
  NOTIFICATION_GLOBAL: 'notification:global',
  
  // Presence
  PRESENCE: 'presence',
  
  // The following are expected based on the site's code but not yet
  // confirmed via frame inspection. They will be verified and added
  // as we discover them.
  // CHAT_REMOVE: 'chat:remove',
  // CHAT_DIRECT: 'chat:direct',
  // ZONES_UPDATE: 'zones:update',
  // ZONES_CLAIM: 'zones:claim',
  // TRADE_OPEN: 'trade:open',
  // TRADE_CLOSE: 'trade:close',
};

/**
 * Connect to the fishtank.live WebSocket server.
 * 
 * This creates an independent connection using Socket.IO v4 with
 * MessagePack encoding.
 * 
 * @param {Function} ioClient - The socket.io-client `io` function
 * @param {Object} msgpackParser - The socket.io-msgpack-parser module
 * @param {Object} options
 * @param {string|null} options.token - JWT auth token. If null, connects
 *   as unauthenticated (global chat only). If omitted (undefined),
 *   attempts to read the token from the site's auth cookie.
 * @param {boolean} options.autoSubscribe - Auto-subscribe to chat:presence
 *   and presence events after connecting (default true, matches site behaviour)
 * @returns {Promise} Resolves when connected and handshake is complete
 */
export async function connect(ioClient, msgpackParser, options = {}) {
  if (socket && connected) return socket;
  if (connectionPromise) return connectionPromise;
  
  const {
    token = undefined,  // undefined = auto-detect, null = force unauthenticated
    autoSubscribe = true,
  } = options;
  
  // Resolve the auth token
  let authToken = token;
  if (authToken === undefined) {
    authToken = getAuthTokenFromCookie();
  }
  
  connectionPromise = new Promise((resolve, reject) => {
    try {
      socket = ioClient(SOCKET_URL, {
        parser: msgpackParser,
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        autoConnect: true,
        // Socket.IO v4 auth option — sent as part of handshake
        auth: {
          token: authToken || null,
        },
      });
      
      socket.on('connect', () => {
        connected = true;
        authenticated = !!authToken;
        console.log(
          '[ftl-ext-sdk] Socket connected',
          authenticated ? '(authenticated)' : '(anonymous)'
        );
        
        // Register any listeners that were added before connection
        for (const { event, callback } of pendingListeners) {
          socket.on(event, callback);
        }
        pendingListeners.length = 0;
        
        resolve(socket);
      });
      
      socket.on('disconnect', (reason) => {
        connected = false;
        authenticated = false;
        console.log('[ftl-ext-sdk] Socket disconnected:', reason);
      });
      
      socket.on('connect_error', (err) => {
        console.warn('[ftl-ext-sdk] Socket connection error:', err.message);
        if (!connected) {
          reject(err);
          connectionPromise = null;
        }
      });
    } catch (err) {
      reject(err);
      connectionPromise = null;
    }
  });
  
  return connectionPromise;
}

/**
 * Disconnect from the server and clean up.
 */
export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  connected = false;
  authenticated = false;
  connectionPromise = null;
  listeners.clear();
  pendingListeners.length = 0;
}

/**
 * Listen for a Socket.IO event from the server.
 * 
 * Can be called before connect() — listeners will be queued and
 * registered once the connection is established.
 * 
 * Returns an unsubscribe function.
 * 
 * @param {string} eventName - The event name (use EVENTS constants)
 * @param {Function} callback - Called with the event data
 * @returns {Function} Unsubscribe function
 */
export function on(eventName, callback) {
  // Track in our own registry
  if (!listeners.has(eventName)) {
    listeners.set(eventName, new Set());
  }
  listeners.get(eventName).add(callback);
  
  // Register on the socket if connected, otherwise queue
  if (socket && connected) {
    socket.on(eventName, callback);
  } else {
    pendingListeners.push({ event: eventName, callback });
  }
  
  // Return unsubscribe function
  return () => {
    listeners.get(eventName)?.delete(callback);
    if (socket) {
      socket.off(eventName, callback);
    }
  };
}

/**
 * Check if the socket is currently connected.
 */
export function isConnected() {
  return connected;
}

/**
 * Check if the socket is authenticated (connected with a valid JWT).
 */
export function isAuthenticated() {
  return authenticated;
}

/**
 * Get the raw socket instance (for advanced use cases).
 * Returns null if not connected.
 */
export function getSocket() {
  return socket;
}

/**
 * Force the socket to disconnect and reconnect.
 * Useful as a recovery mechanism if the connection appears stale.
 * All existing event listeners are preserved across the reconnect.
 */
export function forceReconnect() {
  if (!socket) return;
  console.log('[ftl-ext-sdk] Forcing socket reconnect');
  socket.disconnect();
  // Socket.IO will automatically reconnect due to reconnection: true
  socket.connect();
}

/**
 * Attempt to extract the JWT auth token from the site's Supabase auth cookie.
 * Returns the access_token string or null if not found/not logged in.
 */
function getAuthTokenFromCookie() {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === AUTH_COOKIE_NAME) {
        const value = decodeURIComponent(valueParts.join('='));
        try {
          const parsed = JSON.parse(value);
          // Supabase stores { access_token, refresh_token, ... }
          return parsed.access_token || parsed.token || null;
        } catch {
          // Might be a raw token string
          return value || null;
        }
      }
    }
  } catch (e) {
    console.warn('[ftl-ext-sdk] Failed to read auth cookie:', e.message);
  }
  return null;
}
