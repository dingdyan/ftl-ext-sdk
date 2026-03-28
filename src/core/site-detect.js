/**
 * core/site-detect.js — Environment Detection
 *
 * Detects which version of the site we're on and provides
 * readiness checking for SDK initialisation.
 * 
 * IMPORTANT: This module NEVER creates persistent body-level observers.
 * The site generates thousands of chat mutations per second — a body
 * observer with subtree:true would process every single one and
 * effectively crash the page.
 * 
 * All waiting/detection uses setInterval polling instead.
 */

/**
 * Detect which version of the site we're on.
 *
 * @returns {'current'|'classic'|'unknown'}
 */
export function getSiteVersion() {
  const host = window.location.hostname;
  if (host === 'classic.fishtank.live') return 'classic';
  if (host === 'fishtank.live' || host === 'www.fishtank.live') return 'current';
  return 'unknown';
}

/**
 * Check if the current page is the classic site.
 */
export function isClassic() {
  return getSiteVersion() === 'classic';
}

/**
 * Check if the current page is the new/current site.
 */
export function isCurrent() {
  return getSiteVersion() === 'current';
}

/**
 * Check if the viewport suggests a mobile device.
 */
export function isMobile() {
  return screen.width < 800;
}

/**
 * Check if the site appears ready for SDK use.
 * Looks for key elements that indicate the app has loaded.
 */
export function isSiteReady() {
  if (isCurrent()) {
    return (
      document.getElementById('chat-input') !== null ||
      document.querySelector('[data-react-window-index]') !== null
    );
  }

  if (isClassic()) {
    return !!document.querySelector('[class*="chat_chat__"]');
  }

  return false;
}

/**
 * Wait for the site to be ready, then call the callback.
 * 
 * Uses setInterval polling — NOT a MutationObserver on document.body.
 * Polling at 250ms is negligible overhead compared to a body observer
 * that would fire on every DOM mutation (thousands per second on this site).
 *
 * @param {Function} callback - Called when the site is ready
 * @param {Object} options
 * @param {number} options.interval - Poll interval in ms (default 250)
 * @param {number} options.timeout - Max wait in ms (default 30000)
 * @returns {Function} Cancel function
 */
export function whenReady(callback, options = {}) {
  const { interval = 250, timeout = 30000 } = options;

  // Check immediately
  if (isSiteReady()) {
    setTimeout(callback, 0);
    return () => {};
  }

  const start = Date.now();

  const check = setInterval(() => {
    if (isSiteReady()) {
      clearInterval(check);
      callback();
    } else if (Date.now() - start > timeout) {
      clearInterval(check);
      console.warn('[ftl-ext-sdk] Site ready timeout after', timeout, 'ms.');
    }
  }, interval);

  return () => clearInterval(check);
}

// ---------------------------------------------------------------------------
// Current user detection
// ---------------------------------------------------------------------------

let _currentUser = null;

/**
 * CSS selector for the username element in the top bar.
 */
const USERNAME_SELECTOR = '.fixed.top-\\[calc\\(env\\(safe-area-inset-top\\)\\/2\\)\\] .whitespace-nowrap.font-bold';

/**
 * Read the logged-in user's display name from the top bar.
 * Returns null if not logged in or element not yet in DOM.
 */
function _readUsernameFromDom() {
  const el = document.querySelector(USERNAME_SELECTOR);
  return el?.textContent?.trim() || null;
}

/**
 * Get the currently logged-in user's display name.
 * Reads from cache if available, otherwise checks the DOM once.
 * Returns null if not logged in or username not yet rendered.
 *
 * @returns {string|null}
 */
export function getCurrentUsername() {
  if (!_currentUser) _currentUser = _readUsernameFromDom();
  return _currentUser;
}

/**
 * Wait for the username to appear in the DOM, then call the callback.
 * 
 * Uses setInterval polling — NOT a persistent body observer.
 * Checks every 500ms, gives up after timeout.
 * Once found, the username is cached and the polling stops.
 *
 * @param {Function} callback - Called with the username string
 * @param {number} timeout - Max wait in ms (default 30000)
 * @returns {Function} Cancel function
 */
export function onUserDetected(callback, timeout = 30000) {
  // Already cached
  if (_currentUser) {
    setTimeout(() => callback(_currentUser), 0);
    return () => {};
  }
  
  // Check DOM immediately
  const immediate = _readUsernameFromDom();
  if (immediate) {
    _currentUser = immediate;
    setTimeout(() => callback(_currentUser), 0);
    return () => {};
  }
  
  // Poll until found
  const start = Date.now();
  
  const check = setInterval(() => {
    const name = _readUsernameFromDom();
    if (name) {
      _currentUser = name;
      clearInterval(check);
      callback(_currentUser);
    } else if (Date.now() - start > timeout) {
      clearInterval(check);
      // User might not be logged in — that's fine, not an error
    }
  }, 500);
  
  return () => clearInterval(check);
}
