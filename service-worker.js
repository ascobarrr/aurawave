// ============================================================
// AuraWave Presentation - Service Worker
// Caches all assets for offline use
// ============================================================

const CACHE_NAME = 'aurawave-v1';

// Files to cache immediately on install
const PRECACHE_URLS = [
    './',
    './index.html',
    './script.js',
    './style.css',

    // MediaPipe
    './libs/mediapipe/wasm/vision_bundle.mjs',
    './libs/mediapipe/wasm/vision_wasm_internal.js',
    './libs/mediapipe/wasm/vision_wasm_internal.wasm',
    './libs/mediapipe/wasm/vision_wasm_module_internal.js',
    './libs/mediapipe/wasm/vision_wasm_module_internal.wasm',
    './libs/mediapipe/wasm/vision_wasm_nosimd_internal.js',
    './libs/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
    './libs/mediapipe/hand_landmarker.task',

    // PDF.js
    './libs/pdfjs/build/pdf.min.js',
    './libs/pdfjs/build/pdf.worker.min.js'
];

// ============================================================
// INSTALL: Cache all files
// ============================================================
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching all files');
            return cache.addAll(PRECACHE_URLS);
        }).then(() => self.skipWaiting())
    );
});

// ============================================================
// ACTIVATE: Clean up old caches
// ============================================================
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// ============================================================
// FETCH: Serve from cache, fallback to network
// ============================================================
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then((response) => {
                if (event.request.method !== 'GET' || response.status !== 200) {
                    return response;
                }

                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            }).catch(() => {
                console.log('[Service Worker] Fetch failed, no cache for:', event.request.url);
            });
        })
    );
});

console.log('[Service Worker] Loaded');