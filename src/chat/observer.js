/**
 * chat/observer.js — DOM-Based Chat Message Observation
 *
 * Watches the chat container for new messages via MutationObserver.
 * Parses visible message elements to extract structured data.
 *
 * This approach:
 * - Works without authentication
 * - No extra network connections
 * - Only sees messages currently in the DOM (~17 at a time due to react-window)
 * - Gets text content and visual info but not internal IDs or metadata flags
 *
 * For full structured data (user IDs, medals, metadata), use the
 * Socket.IO approach in chat/messages.js instead.
 */

import { getChatContainer, observe, waitForElement, SELECTORS } from '../core/dom.js';

// Callback registries
const newMessageCallbacks = new Set();

// Track which react-window indices we've already processed
// to avoid firing callbacks for the same message twice
const processedIndices = new Set();

// Observer cleanup function
let disconnectObserver = null;

// Maximum number of processed indices to remember
// (prevents memory leak over long sessions)
const MAX_PROCESSED = 5000;

/**
 * Message type constants.
 */
export const MESSAGE_TYPES = {
  CHAT: 'chat',
  TTS: 'tts',
  SFX: 'sfx',
  SPECIAL: 'special',
};

/**
 * Parse a chat message DOM element into a structured object.
 *
 * Handles three known message formats:
 * - Regular chat messages (username + text)
 * - TTS messages (voice avatar + message bubble + from/to)
 * - SFX messages (SVG icon + sound name bubble + from/to)
 *
 * Returns null if the element can't be parsed.
 *
 * @param {HTMLElement} element - A [data-react-window-index] element
 * @returns {Object|null} Parsed message or null
 */
export function parseMessageElement(element) {
  if (!element || !element.hasAttribute('data-react-window-index')) {
    return null;
  }

  const index = element.getAttribute('data-react-window-index');

  // Detect message type based on DOM structure
  const type = detectMessageType(element);

  switch (type) {
    case MESSAGE_TYPES.TTS:
      return parseTTSMessage(element, index);
    case MESSAGE_TYPES.SFX:
      return parseSFXMessage(element, index);
    case MESSAGE_TYPES.CHAT:
      return parseChatMessage(element, index);
    default:
      return parseUnknownMessage(element, index);
  }
}

/**
 * Detect the message type from DOM structure.
 */
function detectMessageType(element) {
  // TTS: has an img with src containing /images/tts/
  if (element.querySelector('img[src*="/images/tts/"]')) {
    return MESSAGE_TYPES.TTS;
  }

  // SFX: has an SVG icon (no avatar img) + the gradient bubble
  // SFX elements have an SVG as the first visual element and the gradient bubble
  if (element.querySelector('svg.text-primary') && element.querySelector('.bg-gradient-to-t')) {
    return MESSAGE_TYPES.SFX;
  }

  // Regular chat: has the .group wrapper with inline-flex username
  if (element.querySelector('.group') && element.querySelector('.inline-flex.font-bold')) {
    return MESSAGE_TYPES.CHAT;
  }

  // TTS/SFX alternate check: has the gradient bubble + from/to footer
  if (element.querySelector('.bg-gradient-to-t')) {
    // Could be TTS or SFX with a structure we haven't seen
    const hasImg = element.querySelector('img[src*="cdn.fishtank.live"]');
    return hasImg ? MESSAGE_TYPES.TTS : MESSAGE_TYPES.SFX;
  }

  return MESSAGE_TYPES.SPECIAL;
}

/**
 * Parse a regular chat message.
 */
function parseChatMessage(element, index) {
  // Avatar — may be a direct CDN URL or a Next.js optimized image URL
  const avatarImg = element.querySelector('img[class*="rounded-md"]');
  const avatarUrl = extractAvatarUrl(avatarImg);

  // Level (small number overlaid on avatar)
  // It's in an absolute-positioned div near the avatar
  const avatarContainer = element.querySelector('.relative');
  const levelEl = avatarContainer?.querySelector('.absolute');
  const level = levelEl ? parseInt(levelEl.textContent, 10) || null : null;

  // Username (inline-flex, font-bold, has a style color)
  const usernameEl = element.querySelector('.inline-flex.font-bold');
  const username = usernameEl?.textContent?.trim() || null;
  const usernameColor = usernameEl?.style?.color || null;

  // Message text — the span after the username div
  // Could be font-extralight (normal), font-medium (mod), font-regular (fish), font-bold (staff)
  const messageSpan = element.querySelector('span[style*="word-break"]');
  const messageText = messageSpan?.textContent?.trim() || null;

  // Timestamp
  const timestamp = extractTimestamp(element);

  // Mentions — look inside the message span for mention elements
  const mentions = extractMentions(messageSpan);

  // Role detection via background color
  const role = detectRole(avatarUrl, element);

  // Clan tag
  const clanTag = extractClanTag(element);

  return {
    type: MESSAGE_TYPES.CHAT,
    index,
    username,
    usernameColor,
    message: messageText,
    timestamp,
    avatarUrl,
    level,
    role,
    clanTag,
    mentions,
    element,
  };
}

/**
 * Parse a TTS message.
 *
 * Structure:
 * - Voice avatar img (src contains /images/tts/{VoiceName}.png)
 * - Gradient bubble with TTS text
 * - Footer: "From {username} to {room}"
 * - Timestamp
 */
function parseTTSMessage(element, index) {
  // Voice name from the avatar image filename
  const voiceImg = element.querySelector('img[src*="/images/tts/"]');
  const voiceSrc = voiceImg?.getAttribute('src') || '';
  const voiceMatch = voiceSrc.match(/\/images\/tts\/(.+)\.png/);
  const voice = voiceMatch ? decodeURIComponent(voiceMatch[1]) : null;

  // TTS message text (inside the gradient bubble)
  const bubble = element.querySelector('.bg-gradient-to-t');
  const message = bubble?.textContent?.trim() || null;

  // From / To in the footer
  const { from, to } = extractFromTo(element);

  // Timestamp
  const timestamp = extractTimestamp(element);

  return {
    type: MESSAGE_TYPES.TTS,
    index,
    username: from,
    usernameColor: null,
    message,
    timestamp,
    voice,
    room: to,
    avatarUrl: voiceSrc || null,
    level: null,
    role: null,
    clanTag: null,
    mentions: [],
    element,
  };
}

/**
 * Parse an SFX message.
 *
 * Structure:
 * - SVG icon (megaphone/speaker)
 * - Gradient bubble with sound name
 * - Footer: "From {username} to {room}"
 * - Timestamp
 */
function parseSFXMessage(element, index) {
  // Sound name (inside the gradient bubble)
  const bubble = element.querySelector('.bg-gradient-to-t');
  const sound = bubble?.textContent?.trim() || null;

  // From / To in the footer
  const { from, to } = extractFromTo(element);

  // Timestamp
  const timestamp = extractTimestamp(element);

  return {
    type: MESSAGE_TYPES.SFX,
    index,
    username: from,
    usernameColor: null,
    message: sound,
    timestamp,
    sound,
    room: to,
    avatarUrl: null,
    level: null,
    role: null,
    clanTag: null,
    mentions: [],
    element,
  };
}

/**
 * Parse an unrecognised message type.
 * Extracts whatever text content is available.
 */
function parseUnknownMessage(element, index) {
  const textContent = element.textContent?.trim() || '';
  if (!textContent) return null;

  const timestamp = extractTimestamp(element);

  return {
    type: MESSAGE_TYPES.SPECIAL,
    index,
    username: null,
    usernameColor: null,
    message: textContent,
    timestamp,
    avatarUrl: null,
    level: null,
    role: null,
    clanTag: null,
    mentions: [],
    element,
  };
}

/**
 * Extract the actual CDN avatar URL from an img element.
 *
 * The site uses two formats:
 * - Direct: src="https://cdn.fishtank.live/avatars/rchl.png"
 * - Next.js optimized: src="/_next/image?url=https%3A%2F%2Fcdn.fishtank.live%2Favatars%2Ftv.png&w=64&q=75"
 *
 * This extracts the original CDN URL in both cases.
 */
function extractAvatarUrl(imgElement) {
  if (!imgElement) return null;

  const src = imgElement.getAttribute('src') || '';

  // Check for Next.js image optimization URL
  if (src.includes('/_next/image')) {
    try {
      const urlParam = new URL(src, window.location.origin).searchParams.get('url');
      return urlParam ? decodeURIComponent(urlParam) : src;
    } catch {
      // If URL parsing fails, try regex
      const match = src.match(/url=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : src;
    }
  }

  // Direct CDN URL
  return src || null;
}

/**
 * Extract the timestamp from a message element.
 * Works for both regular messages and TTS/SFX messages.
 */
function extractTimestamp(element) {
  // Regular messages: div with font-secondary, text-xs, text-right
  const tsEl = element.querySelector('.font-secondary.text-xs.text-right')
      || element.querySelector('.font-secondary.text-xs');
  return tsEl?.textContent?.trim() || null;
}

/**
 * Extract @mentions from a message element.
 *
 * Mentions are rendered as specific span elements:
 * <span class="text-link font-medium cursor-pointer" contenteditable="false">@Username</span>
 *
 * Falls back to regex matching on text content.
 */
function extractMentions(messageElement) {
  const mentions = [];
  if (!messageElement) return mentions;

  // Primary: find actual mention span elements
  const mentionSpans = messageElement.querySelectorAll('span.text-link[contenteditable="false"]');
  if (mentionSpans.length > 0) {
    mentionSpans.forEach(span => {
      const text = span.textContent?.trim();
      if (text?.startsWith('@')) {
        mentions.push(text.slice(1)); // Remove the @
      }
    });
    return mentions;
  }

  // Fallback: regex on text content
  const textContent = messageElement.textContent || '';
  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(textContent)) !== null) {
    mentions.push(match[1]);
  }

  return mentions;
}

/**
 * Extract "From {username} to {room}" from TTS/SFX footer.
 *
 * Footer structure:
 * <div class="flex items-center translate-y-[2px]">
 *   <div class="leading-none flex gap-1 items-center text-[12px]">
 *     <div class="text-light-text/50">From</div>
 *     <div class="font-bold text-light-text">{username}</div>
 *     <button>
 *       <div class="text-light-text/50">to</div>
 *       <div class="font-medium text-light-text">{room}</div>
 *     </button>
 *   </div>
 * </div>
 */
function extractFromTo(element) {
  let from = null;
  let to = null;

  // Find the footer area with the from/to info
  const footer = element.querySelector('.flex.items-center.translate-y-\\[2px\\]')
      || element.querySelector('.leading-none.flex.gap-1');

  if (!footer) {
    // Fallback: search for the pattern by text content
    const allDivs = element.querySelectorAll('div');
    let foundFrom = false;
    for (const div of allDivs) {
      const text = div.textContent?.trim();
      if (text === 'From') {
        foundFrom = true;
        continue;
      }
      if (foundFrom && !from && div.classList.contains('font-bold')) {
        from = text;
        continue;
      }
      if (text === 'to') {
        continue;
      }
      if (from && !to && div.classList.contains('font-medium')) {
        to = text;
        break;
      }
    }
    return { from, to };
  }

  // Direct parsing: username is in font-bold, room is in font-medium
  const fromEl = footer.querySelector('.font-bold');
  const toEl = footer.querySelector('.font-medium');

  from = fromEl?.textContent?.trim() || null;
  to = toEl?.textContent?.trim() || null;

  return { from, to };
}

/**
 * Detect user role based on the message wrapper's background color classes.
 *
 * This is the most reliable detection method — the site applies distinct
 * background colors to different role types:
 *
 * | Role   | Background class pattern           |
 * |--------|------------------------------------|
 * | Normal | hover:bg-white/5 (no base bg)      |
 * | Mod    | bg-blue-300/5                      |
 * | Fish   | bg-green-300/1                     |
 * | Staff  | bg-fuchsia-300/10                  |
 *
 * Falls back to avatar URL detection as a secondary signal.
 *
 * Returns 'staff', 'fish', 'mod', or null.
 */
function detectRole(avatarUrl, element) {
  // Find the .group wrapper which carries the background color
  const wrapper = element.querySelector('.group') || element;
  const classes = wrapper.className || '';

  // Staff/Wes: fuchsia background
  if (classes.includes('bg-fuchsia-300')) {
    return 'staff';
  }

  // Mod: blue background
  if (classes.includes('bg-blue-300')) {
    return 'mod';
  }

  // Fish (contestant): green background
  if (classes.includes('bg-green-300')) {
    return 'fish';
  }

  // Fallback: avatar URL checks
  if (avatarUrl) {
    if (avatarUrl.includes('avatars/staff.png') || avatarUrl.includes('avatars/wes.png')) {
      return 'staff';
    }
  }

  return null;
}

/**
 * Extract clan tag from a message element.
 * TODO: refine when we see a real clan tag example in the DOM.
 */
function extractClanTag(element) {
  return null;
}

/**
 * Register a callback for new chat messages observed in the DOM.
 *
 * The callback receives a parsed message object (see parseMessageElement).
 * Only fires once per unique message (tracked by react-window index).
 *
 * @param {Function} callback - Called with the parsed message object
 * @returns {Function} Unsubscribe function
 */
export function onMessage(callback) {
  newMessageCallbacks.add(callback);
  return () => newMessageCallbacks.delete(callback);
}

/**
 * Start observing the chat container for new messages.
 *
 * Uses MutationObserver on the chat container's parent (the scrollable
 * wrapper) to detect when react-window adds/removes message elements.
 *
 * @returns {boolean} True if observation started successfully
 */
export function startObserving() {
  if (disconnectObserver) {
    // Already observing
    return true;
  }

  const container = getChatContainer();
  if (!container) {
    console.warn('[ftl-ext-sdk] Chat container not found — cannot start observing');
    return false;
  }

  // Process any messages already in the DOM
  processExistingMessages(container);

  // Watch for new child elements (react-window adding/replacing items)
  disconnectObserver = observe(container, (mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // Skip text nodes

        // Check if this is a message element or contains message elements
        const messageElements = node.hasAttribute('data-react-window-index')
            ? [node]
            : [...node.querySelectorAll('[data-react-window-index]')];

        for (const msgEl of messageElements) {
          processMessageElement(msgEl);
        }
      }
    }
  }, { childList: true, subtree: true });

  console.log('[ftl-ext-sdk] Chat DOM observer started');
  return true;
}

/**
 * Stop observing the chat container.
 */
export function stopObserving() {
  if (disconnectObserver) {
    disconnectObserver();
    disconnectObserver = null;
    console.log('[ftl-ext-sdk] Chat DOM observer stopped');
  }
}

/**
 * Wait for the chat container to appear, then start observing.
 *
 * Uses a short-lived body-level MutationObserver to find the chat
 * container, then immediately disconnects and switches to a targeted
 * observer on the container itself. The body observer only exists
 * until the element is found (or timeout is reached).
 *
 * @param {number} timeout - Max wait time in ms (default 30000)
 * @returns {Promise<boolean>} True if observation started successfully
 */
export async function waitAndObserve(timeout = 30000) {
  if (disconnectObserver) return true;

  // Try immediately first
  if (startObserving()) return true;

  // Wait for the chat container to appear
  try {
    await waitForElement(SELECTORS.CHAT_MESSAGE_ITEM, timeout);
    // Element found — now start the targeted observer
    return startObserving();
  } catch {
    console.warn('[ftl-ext-sdk] Chat container did not appear within', timeout, 'ms');
    return false;
  }
}

/**
 * Check if the observer is currently running.
 */
export function isObserving() {
  return disconnectObserver !== null;
}

/**
 * Process a single message element — parse it and fire callbacks.
 */
function processMessageElement(element) {
  // Ignore elements outside the chat container — modals also use data-react-window-index
  const container = getChatContainer();
  if (container && !container.contains(element)) return;

  const index = element.getAttribute('data-react-window-index');

  // Skip if we've already processed this index
  if (processedIndices.has(index)) return;
  processedIndices.add(index);

  // Prevent memory leak — trim old indices
  if (processedIndices.size > MAX_PROCESSED) {
    const entries = [...processedIndices];
    const toRemove = entries.slice(0, entries.length - MAX_PROCESSED / 2);
    toRemove.forEach(i => processedIndices.delete(i));
  }

  // Parse the message
  const parsed = parseMessageElement(element);
  if (!parsed) return;

  // Fire callbacks
  for (const cb of newMessageCallbacks) {
    try {
      cb(parsed);
    } catch (e) {
      console.error('[ftl-ext-sdk] Chat observer callback error:', e);
    }
  }
}

/**
 * Process all messages currently visible in the DOM.
 * Called when observation starts to catch up on existing messages.
 */
function processExistingMessages(container) {
  const messages = container.querySelectorAll('[data-react-window-index]');
  for (const msgEl of messages) {
    processMessageElement(msgEl);
  }
}

/**
 * Clear the processed indices cache.
 * Useful if you want to re-process all visible messages.
 */
export function resetProcessedCache() {
  processedIndices.clear();
}

/**
 * Convenience: check if a parsed message mentions a specific username.
 */
export function mentionsUser(msg, username) {
  if (!msg?.mentions || !username) return false;
  const lower = username.toLowerCase();
  return msg.mentions.some(m => m.toLowerCase() === lower);
}

/**
 * Convenience: check if a parsed message is from staff.
 */
export function isStaffMessage(msg) {
  return msg?.role === 'staff';
}

/**
 * Convenience: check if a parsed message is from a fish (contestant).
 */
export function isFishMessage(msg) {
  return msg?.role === 'fish';
}

/**
 * Convenience: check if a parsed message is from a mod.
 */
export function isModMessage(msg) {
  return msg?.role === 'mod';
}

/**
 * Convenience: check if a parsed message is a TTS message.
 */
export function isTTSMessage(msg) {
  return msg?.type === MESSAGE_TYPES.TTS;
}

/**
 * Convenience: check if a parsed message is an SFX message.
 */
export function isSFXMessage(msg) {
  return msg?.type === MESSAGE_TYPES.SFX;
}

/**
 * Convenience: check if a parsed message is a regular chat message.
 */
export function isChatMessage(msg) {
  return msg?.type === MESSAGE_TYPES.CHAT;
}