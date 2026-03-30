# ftl-ext-sdk

General-purpose SDK for building browser extensions and Tampermonkey/Greasemonkey userscripts for [fishtank.live](https://fishtank.live).

## Installation

### Browser Extension (npm)

```bash
npm install ftl-ext-sdk
```

```js
import { site, chat, ui, socket } from 'ftl-ext-sdk';
```

### Tampermonkey / Greasemonkey

```js
// @require https://cdn.example.com/ftl-ext-sdk.bundle.js

const { site, chat, ui, socket } = window.FTL;
```

## Quick Start

```js
import { site, chat, ui, socket, events } from 'ftl-ext-sdk';
import { io } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';

// Wait for the site to load
site.whenReady(async () => {

    // Connect to the chat WebSocket
    await socket.connect(io, msgpackParser, { token: null });

    // Start listening for chat events
    chat.messages.startListening();

    // Log staff messages
    chat.messages.onMessage((msg) => {
        if (chat.messages.isStaffMessage(msg)) {
            console.log(`[Staff] ${msg.user.displayName}: ${msg.message}`);
        }
    });

    // Log TTS
    chat.messages.onTTS((tts) => {
        console.log(`[TTS] ${tts.displayName} in ${tts.room}: ${tts.message} (${tts.voice})`);
    });

    // Log SFX
    chat.messages.onSFX((sfx) => {
        console.log(`[SFX] ${sfx.displayName} in ${sfx.room}: ${sfx.sound}`);
    });

    // Register keyboard shortcuts
    ui.keyboard.register('fullscreen', { key: 'f' }, () => {
        // Your fullscreen logic
    });

    ui.keyboard.register('settings', { key: 'e' }, () => {
        // Open your settings modal
    });

    // Watch for craft modal
    events.onModalOpen('craftItem', (modal, data) => {
        // Inject recipe data into the modal
    });

    // Show a toast
    ui.toasts.notify('Extension loaded!', {
        description: 'ftl-ext-sdk is active',
        type: 'success',
    });
});
```

## Modules

### `site` — Environment Detection

```js
import { site } from 'ftl-ext-sdk';

site.getSiteVersion();   // 'current' | 'classic' | 'unknown'
site.isCurrent();        // true on fishtank.live
site.isClassic();        // true on classic.fishtank.live
site.isMobile();         // true on small screens
site.isSiteReady();      // true when key elements are present

// Wait for site to be ready before initialising
site.whenReady(() => {
  console.log('Site is ready!');
});

// Detect the logged-in user
site.getCurrentUsername();  // string or null
site.onUserDetected((username) => {
  console.log('Logged in as:', username);
});
```

### `socket` — Socket.IO Connection

```js
import { socket } from 'ftl-ext-sdk';
import { io } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';

// Connect (pass the socket.io-client and msgpack parser)
// token: null = unauthenticated, undefined = auto-detect from cookie
await socket.connect(io, msgpackParser, { token: null });

// Listen for any event
const unsub = socket.on('chat:message', (data) => {
  console.log(data);
});

// Later: unsubscribe
unsub();

// Check connection status
socket.isConnected();      // true/false
socket.isAuthenticated();  // true/false

// Force a reconnect (e.g. after detecting stale connection)
socket.forceReconnect();

// Disconnect
socket.disconnect();

// Access the raw socket instance
socket.getSocket();
```

#### Known Events

| Constant | Event Name | Description |
|----------|-----------|-------------|
| `EVENTS.CHAT_MESSAGE` | `chat:message` | Chat messages (including happenings) |
| `EVENTS.CHAT_ROOM` | `chat:room` | Room change events |
| `EVENTS.CHAT_PRESENCE` | `chat:presence` | Chat presence updates |
| `EVENTS.TTS_UPDATE` | `tts:update` | TTS submissions and status changes |
| `EVENTS.SFX_INSERT` | `sfx:insert` | SFX submissions |
| `EVENTS.SFX_UPDATE` | `sfx:update` | SFX status changes |
| `EVENTS.CRAFTING_RECIPE_LEARNED` | `items:crafting-recipe:learned` | New crafting recipe discovered |
| `EVENTS.NOTIFICATION_GLOBAL` | `notification:global` | Global notifications / admin messages |
| `EVENTS.PRESENCE` | `presence` | User presence updates |

### `chat.observer` — DOM-Based Chat Observation (Lightweight)

The simplest way to watch chat. No auth, no extra connections. Observes the chat DOM for new messages and parses them.

```js
import { chat } from 'ftl-ext-sdk';

// Watch for new messages in the DOM
chat.observer.onMessage((msg) => {
  console.log(`${msg.username}: ${msg.message}`);
  console.log('Timestamp:', msg.timestamp);
  console.log('Avatar:', msg.avatarUrl);
  console.log('Level:', msg.level);
  console.log('Mentions:', msg.mentions);
  
  // The raw DOM element is available for visual modifications
  if (msg.role === 'staff') {
    msg.element.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
  }
});

// Start observing (call after site is ready)
chat.observer.startObserving();

// Convenience helpers
chat.observer.isStaffMessage(msg);              // boolean
chat.observer.isFishMessage(msg);               // boolean
chat.observer.isModMessage(msg);                // boolean
chat.observer.isTTSMessage(msg);                // boolean
chat.observer.isSFXMessage(msg);                // boolean
chat.observer.isChatMessage(msg);               // boolean
chat.observer.mentionsUser(msg, 'username');     // boolean

// Parse a specific element manually
const parsed = chat.observer.parseMessageElement(someElement);

// Stop observing
chat.observer.stopObserving();
```

> **Note:** The site uses react-window to virtualise the chat list, keeping only ~17 messages
> in the DOM at any time. React-window frequently replaces DOM nodes entirely during
> re-renders, which can cause the MutationObserver to lose its connection to the container
> and stop firing. This makes DOM-based chat observation unreliable for long-running sessions.
> For reliable message capture, use `chat.messages` (Socket.IO) instead. The DOM observer
> is best suited for one-off parsing or short-lived UI modifications where you need access
> to the rendered elements.

#### Observer vs Socket.IO — Which to use?

| | `chat.observer` (DOM) | `chat.messages` (Socket.IO) |
|---|---|---|
| Auth required | No | Optional |
| Extra connections | None | 1 WebSocket |
| Data richness | Text, username, avatar, level | Full user object, medals, metadata flags |
| Reliability | May miss fast-scrolling messages | Captures every message |
| Visual modifications | Yes (has DOM element ref) | No (data only) |
| TTS/SFX | Only if rendered in chat | Dedicated events with full data |
| **Best for** | Simple extensions, UI mods | Comprehensive logging, analytics |

### `chat.messages` — Socket.IO Chat Interception (Full Data)

```js
import { chat } from 'ftl-ext-sdk';

// Register callbacks (can be done before socket connects)
chat.messages.onMessage((msg) => {
  console.log(`${msg.user.displayName}: ${msg.message}`);
  console.log('Watching:', msg.metadata.watching);
  console.log('Is fish:', msg.metadata.isFish);
});

chat.messages.onTTS((tts) => {
  console.log(`TTS by ${tts.displayName}: ${tts.message}`);
});

chat.messages.onSFX((sfx) => {
  console.log(`SFX by ${sfx.displayName}: ${sfx.sound}`);
});

// After socket connects, start listening
chat.messages.startListening();

// Convenience helpers
chat.messages.isFishMessage(msg);           // boolean
chat.messages.isStaffMessage(msg);          // boolean
chat.messages.isModMessage(msg);            // boolean
chat.messages.isHappening(msg);             // boolean
chat.messages.mentionsUser(msg, 'username'); // boolean
```

### `chat.input` — Chat Input

```js
import { chat } from 'ftl-ext-sdk';

chat.input.focus();                      // Focus the input
chat.input.insertText('Hello world');    // Insert text
chat.input.mentionUser('username');      // Insert @mention
chat.input.getText();                    // Get current input text
chat.input.clear();                      // Clear the input
chat.input.getInputElement();            // Get the raw DOM element
```

### `events` — Modal Events

```js
import { events } from 'ftl-ext-sdk';

// Open/close modals
events.openModal('craftItem', { someData: true });
events.closeModal();
events.openConfirmModal({ someData: true });
events.isModalOpen(); // boolean

// Watch for specific modals
const unsub = events.onModalOpen('craftItem', (modalElement, data) => {
  // Inject your content into the modal
});

// Watch all modal events
events.onModalEvent((action, detail) => {
  // action: 'open' | 'close' | 'confirm'
});
```

### `ui.modals` — Modal Helpers

```js
import { ui } from 'ftl-ext-sdk';

// Inject content into the current modal
ui.modals.injectIntoModal(myElement, { position: 'append' });
ui.modals.injectIntoModal('<p>Hello</p>', { position: 'prepend', id: 'my-content' });

// Wait for modal to close
await ui.modals.waitForClose();
```

### `ui.keyboard` — Keyboard Shortcuts

```js
import { ui } from 'ftl-ext-sdk';

// Register a shortcut (auto-skips when user is typing)
const unsub = ui.keyboard.register('my-shortcut', { key: 'e' }, () => {
  console.log('E pressed!');
});

// With modifiers
ui.keyboard.register('save', { key: 's', ctrl: true }, () => {
  console.log('Ctrl+S pressed!');
});

// Stop the event from reaching other handlers (e.g. the site's own shortcuts)
ui.keyboard.register('intercept-t', { key: 't', stopPropagation: true }, () => {
  console.log('T intercepted — site handler will not fire');
});

// Don't prevent the browser's default action (needed for some APIs like fullscreen)
ui.keyboard.register('fullscreen', { key: 'f', preventDefault: false }, () => {
  document.documentElement.requestFullscreen();
});

// The callback receives the keyboard event for conditional logic
ui.keyboard.register('conditional', { key: 'x' }, (e) => {
  if (someCondition) {
    e.stopImmediatePropagation(); // Conditionally block other handlers
  }
});

// Unregister
unsub();
// or
ui.keyboard.unregister('my-shortcut');

// List all registered shortcuts
ui.keyboard.getRegistered(); // ['my-shortcut', 'save', ...]

// Remove all shortcuts
ui.keyboard.unregisterAll();
```

#### Options

| Option | Default | Description |
|--------|---------|-------------|
| `key` | (required) | Key to listen for (e.g. `'e'`, `'escape'`, `'f'`) |
| `ctrl` | `false` | Require Ctrl key |
| `alt` | `false` | Require Alt key |
| `shift` | `false` | Require Shift key |
| `meta` | `false` | Require Meta/Cmd key |
| `skipInputs` | `true` | Don't fire when user is typing in an input/textarea |
| `preventDefault` | `true` | Call `e.preventDefault()` on match |
| `stopPropagation` | `false` | Call `e.stopImmediatePropagation()` on match |

### `ui.toasts` — Toast Notifications

```js
import { ui } from 'ftl-ext-sdk';

// Show a toast
const id = ui.toasts.notify('Hello!', {
  description: 'This is a toast',
  type: 'success',    // 'default' | 'success' | 'error' | 'info'
  duration: 5000,     // ms, 0 for persistent
});

// Dismiss a specific toast
ui.toasts.dismiss(id);
```

### `ui.toastObserver` — Site Toast Observation

Watch for the site's own toast notifications (admin messages, item drops, crafting alerts, etc.).

```js
import { ui } from 'ftl-ext-sdk';

// Wait for the site's toast container to appear, then start observing
const started = await ui.toastObserver.waitAndObserve();

// Register a callback for new toasts
ui.toastObserver.onToast((toast) => {
  console.log('Title:', toast.title);
  console.log('Description:', toast.description);
  console.log('Image URL:', toast.imageUrl);
});

// Parse a toast element manually
const parsed = ui.toastObserver.parseToastElement(someElement);

// Check status
ui.toastObserver.isObserving(); // boolean

// Stop observing
ui.toastObserver.stopObserving();
```

### `player` — Video Player & Streams

```js
import { player } from 'ftl-ext-sdk';

// Streams / Room names
player.streams.fetchRoomNames();            // Fetch room names from the API (cached)
player.streams.roomName('living-room');      // 'Living Room' (human-readable)
player.streams.getRoomMap();                 // { 'living-room': 'Living Room', ... }
player.streams.isPlayerOpen();              // boolean
player.streams.getPlayerElement();          // DOM element or null

// Video
player.video.getElement();       // The video element or null
player.video.toggleFullscreen(); // Toggle browser fullscreen
player.video.isFullscreen();     // boolean
```

### `dom` — DOM Helpers

```js
import { dom } from 'ftl-ext-sdk';

// Stable element access
dom.byId('chat-input');
dom.getChatContainer();
dom.getChatScrollContainer();
dom.getVideoElement();
dom.getVisibleChatMessages();

// Wait for elements
const el = await dom.waitForElement('#modal');

// Observe an element (returns disconnect function)
const disconnect = dom.observe(someElement, (mutations) => {
  // Handle mutations
}, { childList: true, subtree: true });

// Inject content (tagged for easy cleanup)
dom.inject(myElement, targetElement, 'append', 'my-injection');

// Remove injected content
dom.removeInjected('my-injection');  // specific
dom.removeInjected();                // all SDK injections
```

### `storage` — Local Storage

```js
import { storage } from 'ftl-ext-sdk';

// All keys are automatically prefixed with 'ftl-sdk:'
storage.set('myKey', { some: 'data' });
storage.get('myKey');          // { some: 'data' }
storage.get('missing', []);    // [] (default value)
storage.remove('myKey');
storage.keys();                // ['myKey', ...]
storage.clear();               // Clears only SDK keys
```

### `react` — React Fiber Access (Advanced)

```js
import { react } from 'ftl-ext-sdk';

// Check if React is available
react.isAvailable(); // boolean

// Get the React fiber key for the current page
react.getReactFiberKey(); // e.g. '__reactFiber$abc123'

// Get fiber for a DOM element
const fiber = react.getFiber(someElement);

// Get React props for a DOM element
const props = react.getProps(someElement);

// Walk the fiber tree upward
react.walkFiberUp(element, (fiber) => {
  // Return true to stop and return this fiber
  return fiber.memoizedProps?.someSpecificProp;
});

// Walk the fiber tree downward
react.walkFiberDown(fiber, (fiber) => {
  return fiber.type === 'SomeComponent';
});

// Find a hook state value in a fiber
react.findHookState(fiber, (state) => {
  return state?.someField === 'value';
});

// Search the entire fiber tree from the root
react.findInTree((fiber) => {
  return fiber.memoizedProps?.targetProp;
});
```

## Chat Message Object Reference

Messages received via `chat.messages.onMessage()`:

```js
{
  id: "e9d008d1-...",           // Message UUID
  user: {
    id: "6fac9c70-...",         // User UUID ("happening" for system events)
    displayName: "BarryThePirate",
    photoURL: "https://cdn.fishtank.live/avatars/rchl.png",
    customUsernameColor: "#966b9e",
    clan: null,                  // Clan tag or null
    clanColor: null,             // Clan colour or null
    medals: ["tinnitus", "swag", "season-pass", ...],
    xp: 451,
    endorsement: null,
    endorsementColor: null,
  },
  message: "The world is a vampire", // Message text
  type: "message",
  admin: false,
  timestamp: 1742519388236,      // Unix timestamp (ms)
  mentions: [                    // Array of mention objects
    { displayName: "someuser", userId: "uuid-..." }
  ],
  clips: [],
  metadata: {
    isGrandMarshall: false,
    isEpic: false,
    isFish: false,               // Contestant
    isFree: false,               // No season pass
    isAdmin: false,
    isMod: false,
    watching: "",                // Room code being watched
  },
  tempId: "019d112d-...",
  nsp: "/",                      // Namespace ("/" = global chat)
}
```

**Important:** Socket `chat:message` data arrives wrapped in an array — `[{...}]` not `{...}`. The `chat.messages` module handles this automatically, but if you use `socket.on('chat:message')` directly, unwrap it: `const msg = Array.isArray(data) ? data[0] : data;`

**Important:** The `mentions` field contains objects `{ displayName, userId }`, not strings.

## Building

```bash
npm install
npm run build    # Builds dist/ftl-ext-sdk.bundle.js
npm run watch    # Rebuild on changes
```

## Architecture

The SDK is organised into layers:

1. **Core** (`src/core/`) — Low-level access: React fiber, Socket.IO, DOM, events, storage
2. **Feature Modules** (`src/chat/`, `src/player/`, `src/ui/`) — High-level APIs built on core
3. **Adapters** (`src/adapters/`) — Site-version-specific configuration

### Design Principles

- **Data layer first** — Access Zustand stores and Socket.IO for data; DOM only for UI injection
- **No class name dependencies** — Never rely on Tailwind utility classes for element identification
- **Non-destructive** — Never modify the site's own connections, state, or event handlers
- **Extension-store friendly** — No monkey-patching, no remote code loading, no eval
- **Fail silently** — Missing elements return null, never throw in production paths
- **Namespaced DOM** — All injected elements use `data-ftl-sdk` attributes

## License

MIT