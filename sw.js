// Karta PWA Service Worker
// Version: 1.0.1

const CACHE_NAME = 'karta-cache-v2';
const STATIC_CACHE = 'karta-static-v2';
const CDN_CACHE = 'karta-cdn-v2';

// Static files to cache (local files)
const STATIC_FILES = [
    './',
    './index.html',
    './admin.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './payment-qr.jpg',
    './karta-logo-design.png'
];

// External CDN resources to cache
const CDN_FILES = [
    'https://cdn.tailwindcss.com?plugins=forms,typography,aspect-ratio,container-queries',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js',
    'https://cdn.jsdelivr.net/npm/nepali-date-converter@latest/dist/nepali-date-converter.umd.js',
    'https://cdn.jsdelivr.net/npm/@anuz-pandey/nepali-date-picker@latest/dist/nepali-date-picker.min.css',
    'https://cdn.jsdelivr.net/npm/@anuz-pandey/nepali-date-picker@latest/dist/nepali-date-picker.bundle.min.js',
    'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js',
    'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js',
    'https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');

    event.waitUntil(
        Promise.all([
            // Cache static files
            caches.open(STATIC_CACHE).then((cache) => {
                console.log('[SW] Caching static files...');
                return cache.addAll(STATIC_FILES).catch(err => {
                    console.warn('[SW] Some static files failed to cache:', err);
                });
            }),
            // Cache CDN files
            caches.open(CDN_CACHE).then((cache) => {
                console.log('[SW] Caching CDN files...');
                // Cache CDN files one by one to handle failures gracefully
                return Promise.allSettled(
                    CDN_FILES.map(url =>
                        fetch(url, { mode: 'cors' })
                            .then(response => {
                                if (response.ok) {
                                    return cache.put(url, response);
                                }
                            })
                            .catch(err => console.warn(`[SW] Failed to cache ${url}:`, err))
                    )
                );
            })
        ]).then(() => {
            console.log('[SW] Installation complete!');
            return self.skipWaiting();
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete old versions of our caches
                    if (cacheName !== STATIC_CACHE && cacheName !== CDN_CACHE && cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Activation complete!');
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip Firebase realtime database requests (they need live connection)
    if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebase')) {
        // For Firebase, try network first, but don't fail completely
        event.respondWith(
            fetch(event.request).catch(() => {
                // Return a simple offline response for Firebase
                return new Response(JSON.stringify({ offline: true }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // For CDN resources - cache first, then network
    if (url.hostname !== location.hostname) {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) {
                    // Return cached version, but also update cache in background
                    fetch(event.request).then((networkResponse) => {
                        if (networkResponse.ok) {
                            caches.open(CDN_CACHE).then((cache) => {
                                cache.put(event.request, networkResponse);
                            });
                        }
                    }).catch(() => { });
                    return cachedResponse;
                }

                // Not in cache, try network
                return fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(CDN_CACHE).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    console.warn('[SW] CDN fetch failed:', event.request.url);
                    return new Response('', { status: 503 });
                });
            })
        );
        return;
    }

    // For local files - cache first strategy
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            // Not in cache, try network and cache for future
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse.ok) {
                    const responseClone = networkResponse.clone();
                    caches.open(STATIC_CACHE).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Offline and not cached - return offline page for navigation
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return new Response('Offline', { status: 503 });
            });
        })
    );
});

// Background sync for data (when online again)
self.addEventListener('sync', (event) => {
    console.log('[SW] Background sync triggered:', event.tag);

    if (event.tag === 'sync-data') {
        event.waitUntil(
            // Notify all clients to sync their data
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'SYNC_DATA' });
                });
            })
        );
    }
});

// Listen for messages from the main app
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then((cacheNames) => {
            cacheNames.forEach((cacheName) => {
                caches.delete(cacheName);
            });
        });
    }
});

console.log('[SW] Service Worker script loaded');
