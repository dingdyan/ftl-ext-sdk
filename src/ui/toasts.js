/**
 * ui/toasts.js — Toast Notifications
 *
 * Creates a toast notification system that visually matches the site's
 * own Sonner toasts. Positioned bottom-center to match the site's
 * toast placement.
 *
 * We can't inject into Sonner's toaster because it doesn't render
 * its <ol> container until the first real toast is triggered. Instead
 * we create our own container with matching styling.
 */

// Icon SVGs for toast types
const ICONS = {
  default: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="28" width="28" xmlns="http://www.w3.org/2000/svg"><path d="M256 56C145.72 56 56 145.72 56 256s89.72 200 200 200 200-89.72 200-200S366.28 56 256 56zm0 82a26 26 0 1 1-26 26 26 26 0 0 1 26-26zm48 226h-88a16 16 0 0 1 0-32h28v-88h-16a16 16 0 0 1 0-32h32a16 16 0 0 1 16 16v104h28a16 16 0 0 1 0 32z"></path></svg>`,
  success: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="28" width="28" xmlns="http://www.w3.org/2000/svg"><path d="M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208 208-93.31 208-208S370.69 48 256 48zm108.25 138.29-134.4 160a16 16 0 0 1-12 5.71h-.27a16 16 0 0 1-11.89-5.3l-57.6-64a16 16 0 1 1 23.78-21.4l45.29 50.32 122.59-145.91a16 16 0 0 1 24.5 20.58z"></path></svg>`,
  error: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="28" width="28" xmlns="http://www.w3.org/2000/svg"><path d="M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208 208-93.31 208-208S370.69 48 256 48zm75.31 260.69a16 16 0 1 1-22.62 22.62L256 278.63l-52.69 52.68a16 16 0 0 1-22.62-22.62L233.37 256l-52.68-52.69a16 16 0 0 1 22.62-22.62L256 233.37l52.69-52.68a16 16 0 0 1 22.62 22.62L278.63 256z"></path></svg>`,
  info: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="28" width="28" xmlns="http://www.w3.org/2000/svg"><path d="M256 56C145.72 56 56 145.72 56 256s89.72 200 200 200 200-89.72 200-200S366.28 56 256 56zm0 82a26 26 0 1 1-26 26 26 26 0 0 1 26-26zm48 226h-88a16 16 0 0 1 0-32h28v-88h-16a16 16 0 0 1 0-32h32a16 16 0 0 1 16 16v104h28a16 16 0 0 1 0 32z"></path></svg>`,
};

const ICON_COLOURS = {
  default: 'text-primary',
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-primary',
};

let container = null;
let styleInjected = false;

/**
 * Inject animation styles.
 */
function injectStyles() {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.id = 'ftl-ext-toast-styles';
  style.textContent = `
    #ftl-ext-toasts {
      position: fixed;
      bottom: 96px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column-reverse;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }
    @media (max-width: 1023px) {
      #ftl-ext-toasts {
        bottom: 64px;
      }
    }
    .ftl-ext-toast {
      pointer-events: auto;
      animation: ftl-ext-toast-in 0.3s ease forwards;
    }
    .ftl-ext-toast-out {
      animation: ftl-ext-toast-out 0.3s ease forwards;
    }
    @keyframes ftl-ext-toast-in {
      from { opacity: 0; transform: translateY(16px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes ftl-ext-toast-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(16px) scale(0.95); }
    }
  `;
  document.head.appendChild(style);
  styleInjected = true;
}

/**
 * Ensure the toast container exists.
 */
function ensureContainer() {
  if (container && document.body.contains(container)) return;
  injectStyles();
  container = document.createElement('div');
  container.id = 'ftl-ext-toasts';
  document.body.appendChild(container);
}

/**
 * Show a toast notification.
 *
 * @param {string} title - Toast title
 * @param {Object} options
 * @param {string} options.description - Optional description text
 * @param {number} options.duration - Display duration in ms (default 5000)
 * @param {'default'|'success'|'error'|'info'} options.type - Toast style
 * @param {string} options.id - Optional ID (prevents duplicate toasts)
 * @returns {string} Toast ID
 */
export function notify(title, options = {}) {
  const {
    description = '',
    duration = 5000,
    type = 'default',
    id = `ftl-ext-${Date.now()}`,
  } = options;

  ensureContainer();

  // Prevent duplicates
  if (container.querySelector(`[data-ftl-toast-id="${id}"]`)) return id;

  const icon = ICONS[type] || ICONS.default;
  const iconColour = ICON_COLOURS[type] || ICON_COLOURS.default;

  const toast = document.createElement('div');
  toast.className = 'ftl-ext-toast';
  toast.setAttribute('data-ftl-toast-id', id);

  toast.innerHTML = `
    <div class="relative flex rounded-lg shadow-lg ring-1 items-center p-4 font-sans bg-light [background-image:var(--texture-panel)] ring-dark-300/95" style="width: 368px; max-width: calc(100vw - 32px);">
      <div class="flex items-start m-auto mr-2 drop-shadow-[1px_1px_0_#00000025] ${iconColour}">
        ${icon}
      </div>
      <div class="flex flex-1 items-center">
        <div class="w-full">
          <p class="text-lg font-medium leading-5 text-dark-text">${escapeHtml(title)}</p>
          ${description ? `<p class="mt-1 text-sm leading-4 text-dark-text-400">${escapeHtml(description)}</p>` : ''}
        </div>
      </div>
      <button class="absolute top-0 right-0 p-3 cursor-pointer z-1 text-dark-text/50 hover:text-dark-text" data-ftl-dismiss="${id}">
        <svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg"><path d="M400 145.49 366.51 112 256 222.51 145.49 112 112 145.49 222.51 256 112 366.51 145.49 400 256 289.49 366.51 400 400 366.51 289.49 256 400 145.49z"></path></svg>
      </button>
    </div>
  `;

  // Dismiss on X click
  toast.querySelector(`[data-ftl-dismiss="${id}"]`)?.addEventListener('click', () => dismiss(id));

  container.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }

  return id;
}

/**
 * Dismiss a toast by ID.
 */
export function dismiss(id) {
  if (!container) return;

  const toast = container.querySelector(`[data-ftl-toast-id="${id}"]`);
  if (!toast) return;

  toast.classList.add('ftl-ext-toast-out');
  toast.classList.remove('ftl-ext-toast');
  setTimeout(() => toast.remove(), 300);
}

/**
 * Escape HTML to prevent XSS in toast content.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
