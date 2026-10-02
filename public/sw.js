/*
 * Minimal service worker for PWA installability (Chromium requires a
 * registered worker with a fetch handler before it offers the install
 * prompt). Deliberately a pure network passthrough — it never caches or
 * responds from a cache, so it cannot serve stale app code and the
 * platform's redeploy flow is unaffected. iOS ignores it and installs via
 * Add-to-Home-Screen using the manifest + apple-touch-icon instead.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No respondWith() — the browser's default network handling applies.
});
