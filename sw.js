/* VSK — offline-first: static precache + content cache + dynamic AI cache */

const VERSION = "vsk-pwa-v12";
const AI_CACHE = "vsk-ai-models-v1";
const CONTENT_CACHE = VERSION;

const FUSE_CDN = "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js";

const PRECACHE_CORE = [
  "./",
  "index.html",
  "article.html",
  "checklist.html",
  "contacts.html",
  "style.css",
  "semantic-search.js",
  "app.js",
  "manifest.json",
  "assets/icon-orange.svg",
  "data/checklists/bug-out-bag.json",
];

/** Toan bo file noi dung bai viet va hinh anh hien co trong repo */
const PRECACHE_ASSETS = [
  "data/articles/index.json",
  "data/articles/bi-dia-vat-can-mau-chay.json",
  "data/articles/cam-mau.json",
  "data/articles/da-phai-dinh-gi-set-trong-nuoc-lu.json",
  "data/articles/dien-giat-do-cot-dien-do-xuong-nuoc.json",
  "data/articles/duoi-nuoc.json",
  "data/articles/hoc-di-vat.json",
  "data/articles/loc-nuoc.json",
  "data/articles/ngo-doc.json",
  "data/articles/ran-can.json",
  "data/articles/soc-phan-ve.json",
  "data/articles/tre-nuot-dong-xu.json",
  "data/articles/ve-sinh.json",
  "assets/images/ran-can-1.svg",
  "assets/images/ran-can-2.svg",
  "assets/images/ran-can-3.svg",
  "assets/images/ran-can-4.svg",
  "assets/images/ran-can-5.svg",
  "assets/icon-orange.svg",
];

const PRECACHE_URLS = Array.from(new Set([...PRECACHE_CORE, ...PRECACHE_ASSETS]));

function scopeUrl(relative) {
  return new URL(relative, self.registration.scope).href;
}

async function putOptional(cache, url) {
  try {
    const res = await fetch(url, { cache: "reload" });
    if (res && res.ok) await cache.put(url, res);
  } catch {
    // ignore
  }
}

function canonicalAiCacheKey(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    u.search = "";
    return u.href;
  } catch {
    return href;
  }
}

async function aiMatchCached(cache, reqUrl) {
  const key = canonicalAiCacheKey(reqUrl);
  let hit = await cache.match(key);
  if (hit) return hit;
  hit = await cache.match(new Request(key), { ignoreSearch: true });
  if (hit) return hit;
  const wantPath = new URL(key).pathname;
  for (const cachedReq of await cache.keys()) {
    try {
      if (new URL(cachedReq.url).pathname === wantPath) {
        hit = await cache.match(cachedReq);
        if (hit) return hit;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** Giu nguyen dynamic cache AI dang hoat dong */
async function aiNetworkFirstDynamic(req) {
  const cache = await caches.open(AI_CACHE);
  const cacheKey = canonicalAiCacheKey(req.url);
  try {
    const forwardReq = new Request(req, { redirect: "follow" });
    const res = await fetch(forwardReq);
    if (res.ok) {
      try {
        await cache.put(cacheKey, res.clone());
      } catch {
        // ignore
      }
    }
    return res;
  } catch {
    const stale = await aiMatchCached(cache, req.url);
    if (stale) return stale;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

function isAiInterceptUrl(url) {
  const href = url.href;
  if (href.includes("huggingface.co")) return true;
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("/npm/@xenova")) return true;
  return false;
}

function isSameOrigin(href) {
  try {
    return new URL(href).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isArticleAssetPath(pathname) {
  if (pathname.startsWith("/data/articles/") && pathname.endsWith(".json")) return true;
  if (pathname.startsWith("/assets/images/") && (pathname.endsWith(".svg") || pathname.endsWith(".png"))) {
    return true;
  }
  return false;
}

function extractArticleImagePaths(text) {
  if (!text) return [];
  const re = /assets\/images\/[A-Za-z0-9._/-]+\.(svg|png)/gi;
  const found = new Set();
  let m = null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[0]);
  }
  return Array.from(found);
}

async function expandContentCacheFromArticlesIndex(indexJson) {
  const list = Array.isArray(indexJson)
    ? indexJson
    : Array.isArray(indexJson?.articles)
      ? indexJson.articles
      : [];
  if (!list.length) return;

  const cache = await caches.open(CONTENT_CACHE);
  for (const item of list) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    const articleRel = `data/articles/${encodeURIComponent(id)}.json`;
    const articleUrl = scopeUrl(articleRel);
    await putOptional(cache, articleUrl);
    try {
      const articleRes = await cache.match(articleUrl, { ignoreSearch: true });
      if (!articleRes) continue;
      const articleText = await articleRes.clone().text();
      const imageRels = extractArticleImagePaths(articleText);
      for (const rel of imageRels) {
        await putOptional(cache, scopeUrl(rel));
      }
    } catch {
      // ignore malformed article content
    }
  }
}

async function warmContentFromArticlesIndex() {
  try {
    const req = new Request(scopeUrl("data/articles/index.json"), { redirect: "follow" });
    const res = await fetch(req);
    if (!res || !res.ok) return;
    const cache = await caches.open(CONTENT_CACHE);
    await cache.put(scopeUrl("data/articles/index.json"), res.clone());
    const indexJson = await res.clone().json();
    await expandContentCacheFromArticlesIndex(indexJson);
  } catch {
    // ignore while offline
  }
}

/**
 * Điều hướng (navigate): chỉ đọc HTML từ cache — không fetch ra máy chủ (tránh redirect clean URL / SW “redirect mode”).
 * Không có đường dẫn `/articles/` (thư mục JSON) là trang article.
 */
function navigateHtmlForPathname(pathname) {
  const p = String(pathname || "").toLowerCase();
  const isArticlesFolder = p.includes("/articles/") || p.endsWith("/articles");

  if (!isArticlesFolder && p.includes("article")) return "article.html";
  if (p.includes("checklist")) return "checklist.html";
  if (p.includes("contacts")) return "contacts.html";
  return "index.html";
}

/**
 * HTML lấy từ cache sau install có thể là redirected response → tái tạo Response
 * để không còn cờ redirect (tránh lỗi SW / navigate).
 */
async function unwrapCachedHtmlResponse(cachedRes) {
  if (!cachedRes) return null;

  const headers = new Headers(cachedRes.headers);
  headers.delete("Location");

  try {
    if (cachedRes.body) {
      return new Response(cachedRes.body, {
        status: 200,
        statusText: "OK",
        headers,
      });
    }
  } catch {
    // fall through
  }

  try {
    const blob = await cachedRes.blob();
    return new Response(blob, {
      status: 200,
      statusText: "OK",
      headers,
    });
  } catch {
    return null;
  }
}

/** Navigate: cache-only map — tuyệt đối không gọi fetch(req). */
async function respondNavigateCacheOnly(req) {
  const cache = await caches.open(CONTENT_CACHE);
  const pathname = new URL(req.url).pathname;
  const file = navigateHtmlForPathname(pathname);

  const routeRes = await cache.match(scopeUrl(file), { ignoreSearch: true });
  if (routeRes) {
    const out = await unwrapCachedHtmlResponse(routeRes);
    if (out) return out;
  }

  const indexRes = await cache.match(scopeUrl("index.html"), { ignoreSearch: true });
  if (indexRes) {
    const out = await unwrapCachedHtmlResponse(indexRes);
    if (out) return out;
  }

  return new Response("Offline", { status: 503, statusText: "Offline" });
}

async function cacheFirstWithBackgroundRefresh(req) {
  const cache = await caches.open(CONTENT_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) {
    // stale-while-revalidate
    void (async () => {
      try {
        const fresh = await fetch(new Request(req, { redirect: "follow" }));
        if (fresh && fresh.ok) await cache.put(req, fresh.clone());
      } catch {
        // ignore refresh error
      }
    })();
    return cached;
  }
  try {
    const res = await fetch(new Request(req, { redirect: "follow" }));
    if (res && res.ok) {
      try {
        await cache.put(req, res.clone());
      } catch {
        // ignore
      }
    }
    return res;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstWithCacheFallback(req) {
  const cache = await caches.open(CONTENT_CACHE);
  try {
    const res = await fetch(new Request(req, { redirect: "follow" }));
    if (res && res.ok) {
      try {
        await cache.put(req, res.clone());
      } catch {
        // ignore
      }
      return res;
    }
  } catch {
    // ignore
  }
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

async function networkFirstArticlesIndex(req) {
  const cache = await caches.open(CONTENT_CACHE);
  try {
    const res = await fetch(new Request(req, { redirect: "follow" }));
    if (res && res.ok) {
      try {
        await cache.put(req, res.clone());
      } catch {
        // ignore
      }
      try {
        const indexJson = await res.clone().json();
        void expandContentCacheFromArticlesIndex(indexJson);
      } catch {
        // ignore bad json
      }
      return res;
    }
  } catch {
    // ignore
  }
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  return new Response("[]", { status: 503, statusText: "Offline", headers: { "Content-Type": "application/json" } });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CONTENT_CACHE);
      for (const rel of PRECACHE_URLS) {
        await putOptional(cache, scopeUrl(rel));
      }
      await putOptional(cache, FUSE_CDN);
      await warmContentFromArticlesIndex();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k === CONTENT_CACHE || k === AI_CACHE ? Promise.resolve() : caches.delete(k)))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (isAiInterceptUrl(url)) {
    event.respondWith(aiNetworkFirstDynamic(req));
    return;
  }

  if (url.origin === "https://cdn.jsdelivr.net" && (url.href === FUSE_CDN || url.pathname.includes("fuse"))) {
    event.respondWith(cacheFirstWithBackgroundRefresh(req));
    return;
  }

  if (!isSameOrigin(req.url)) return;
  if (url.pathname.endsWith("/sw.js") || url.pathname.endsWith("sw.js")) return;

  // Noi dung bai viet: cache-first (co refresh nen)
  if (isArticleAssetPath(url.pathname)) {
    event.respondWith(cacheFirstWithBackgroundRefresh(req));
    return;
  }

  if (url.pathname === "/data/articles/index.json") {
    event.respondWith(networkFirstArticlesIndex(req));
    return;
  }

  // JSON noi bo khac: network-first + fallback cache
  if (url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirstWithCacheFallback(req));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(respondNavigateCacheOnly(req));
    return;
  }

  event.respondWith(cacheFirstWithBackgroundRefresh(req));
});
