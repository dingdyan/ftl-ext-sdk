// ==UserScript==
// @name         FTL Ext SDK Demo
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Demo userscript for ftl-ext-sdk - connects to fishtank.live and logs chat messages
// @author       Your Name
// @match        https://fishtank.live/*
// @grant        none
// @require      https://github.com/BarryThePirate/ftl-ext-sdk/raw/main/dist/ftl-ext-sdk.bundle.js
// ==/UserScript==

(function() {
    'use strict';

    // Wait for the SDK to load
    function waitForSDK() {
        if (typeof window.FTL !== 'undefined') {
            initSDK();
        } else {
            setTimeout(waitForSDK, 100);
        }
    }

    // Initialize the SDK
    async function initSDK() {
        console.log('[FTL Demo] SDK loaded, initializing...');

        try {
            // Connect to the socket (anonymous, no token needed for reading)
            await window.FTL.socket.connect({ token: null });
            console.log('[FTL Demo] Connected to fishtank.live');

            // Listen for chat messages
            window.FTL.socket.on(window.FTL.socket.EVENTS.CHAT_MESSAGE, (data) => {
                console.log('[FTL Demo] Chat message:', data);

                // Show a toast notification for each message
                showToast(`New message: ${data.username || 'Anonymous'}: ${data.message || '(empty)'}`);
            });

            // Listen for connection events
            window.FTL.socket.on('connect', () => {
                console.log('[FTL Demo] Socket connected');
                showToast('Connected to fishtank.live!');
            });

            window.FTL.socket.on('disconnect', () => {
                console.log('[FTL Demo] Socket disconnected');
                showToast('Disconnected from fishtank.live');
            });

        } catch (error) {
            console.error('[FTL Demo] Error initializing SDK:', error);
            showToast('Error connecting to fishtank.live');
        }
    }

    // Simple toast notification function
    function showToast(message) {
        // Create toast element
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
        `;
        toast.textContent = message;

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes fadeOut {
                from {
                    opacity: 1;
                }
                to {
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);

        // Add to page
        document.body.appendChild(toast);

        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    // Start waiting for SDK
    waitForSDK();
})();
