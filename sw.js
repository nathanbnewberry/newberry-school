// Lets the games run with no internet. Built into site/sw.js by tools/build-site.mjs.
const BUILD = "71923a1126ca", APP = `app-${BUILD}`, MEDIA = "media-v1";
const SHELL = ["./","lessons.js?v=84132dd37a","manifest.webmanifest","voice/lines.json","castle/","pirates/","sfx/bell.mp3","sfx/blip.mp3","sfx/bump.mp3","sfx/cheer.mp3","sfx/coin.mp3","sfx/dash.mp3","sfx/ding.mp3","sfx/fanfare.mp3","sfx/gallop.mp3","sfx/gunshot.mp3","sfx/hammer.mp3","sfx/jump.mp3","sfx/key.mp3","sfx/moo.mp3","sfx/pop.mp3","sfx/ricochet.mp3","sfx/rope.mp3","sfx/soft.mp3","sfx/sting.mp3","sfx/thud.mp3","sfx/trail.mp3","sfx/whinny.mp3"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // One missing file must never stop the game from installing.
  e.waitUntil(caches.open(APP).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("app-") && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const refreshed = new Set();
async function mediaFile(url) {
  const cache = await caches.open(MEDIA), hit = await cache.match(url);
  if (hit) {
    // Quietly pick up a re-recorded clip, once per clip each time the worker starts.
    if (!refreshed.has(url)) { refreshed.add(url); fetch(url).then((r) => { if (r.ok) cache.put(url, r); }).catch(() => {}); }
    return hit.clone();
  }
  const res = await fetch(url);
  if (res.ok) await cache.put(url, res.clone());
  return res;
}
// iPads ask for audio in byte ranges, and a saved file has to answer that way or it won't play.
async function ranged(res, header) {
  const m = /bytes=(\d*)-(\d*)/.exec(header || "");
  if (!m || !res.ok) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const start = m[1] === "" ? Math.max(0, size - +m[2]) : +m[1], end = m[1] !== "" && m[2] !== "" ? Math.min(+m[2], size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
}
async function networkFirst(req, wait = 8000) {
  const cache = await caches.open(APP);
  // The page and its scripts skip the browser's own cache, so a new version shows the first time (2026-11-09).
  const fresh = req.mode === "navigate" || /\.(html|js)$|\/$/.test(new URL(req.url).pathname) ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" }) : req;
  const net = fetch(fresh).then((res) => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; });
  const saved = async () => (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await cache.match("./") : undefined);
  try {
    return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error("slow")), wait))]);
  } catch (e) {
    const hit = await saved();
    if (hit) return hit;
    // Nothing saved yet, so a slow connection just keeps loading rather than failing.
    return net.catch(() => new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }));
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(MEDIA), hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return e.respondWith(cacheFirst(req).catch(() => new Response("", { status: 503 })));
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith("/version.txt")) return e.respondWith(fetch(req).catch(() => new Response("", { status: 503 })));
  if (/\/(voice|sfx)\/[^/]+\.mp3$/.test(url.pathname)) return e.respondWith(mediaFile(url.origin + url.pathname).then((r) => ranged(r, req.headers.get("range"))).catch(() => new Response("", { status: 503 })));
  e.respondWith(networkFirst(req));
});
