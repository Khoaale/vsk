/**
 * Semantic search (Transformers.js + IndexedDB vectors)
 * ES module: scope riêng; không dùng `export` — chỉ gán API trên window cho app.js.
 */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

env.allowLocalModels = false;
/** Tắt cache built-in của thư viện — để SW (sw.js) lo HF/CDN; tránh lỗi Cache.put / trùng lớp cache trong console */
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";

const DB_NAME = "vsk-semantic-db";
const DB_VERSION = 1;
const STORE = "embeddings";

const AI_ARTICLE_INDEX_URL = "data/articles/index.json";
const AI_ARTICLE_DIR = "data/articles";

const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
  });
}

function dbGetAllEmbeddings(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbClearEmbeddings(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbPutAllEmbeddings(db, rows) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    const os = tx.objectStore(STORE);
    for (const row of rows) {
      os.put(row);
    }
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${url}: ${res.status}`);
  return res.json();
}

function asVec(raw) {
  if (!raw) return new Float32Array(0);
  if (raw instanceof Float32Array) return raw;
  if (ArrayBuffer.isView(raw)) return new Float32Array(raw.buffer, raw.byteOffset, raw.length);
  return Float32Array.from(raw);
}

function cosineSimilarityUnitVectors(a, b) {
  const va = asVec(a);
  const vb = asVec(b);
  const n = va.length;
  if (!n || n !== vb.length) return -1;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += va[i] * vb[i];
  return dot;
}

let pipelinePromise = null;

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", EMBED_MODEL, { quantized: true });
  }
  return pipelinePromise;
}

async function embedText(extractor, text) {
  const out = await extractor(String(text || "").trim(), {
    pooling: "mean",
    normalize: true,
  });
  const raw = out?.data != null ? out.data : out;
  return asVec(raw);
}

function normalizeArticleList(rawIndex) {
  if (Array.isArray(rawIndex)) return rawIndex;
  if (rawIndex && Array.isArray(rawIndex.articles)) return rawIndex.articles;
  return [];
}

async function indexNeedsRebuild(db, articleMetas) {
  if (!articleMetas.length) return false;
  const existing = await dbGetAllEmbeddings(db);
  if (existing.length !== articleMetas.length) return true;
  const wanted = new Set(articleMetas.map((x) => x.id).filter(Boolean));
  if (wanted.size !== articleMetas.length) return true;
  for (const row of existing) {
    if (!wanted.has(row.id)) return true;
    const emb = row.embedding;
    if (!emb || (!Array.isArray(emb) && !(emb instanceof Float32Array))) return true;
    if (Array.isArray(emb) && emb.length === 0) return true;
    if (emb instanceof Float32Array && emb.length === 0) return true;
  }
  return false;
}

let ensureIndexPromise = null;

async function ensureSemanticIndex() {
  if (!ensureIndexPromise) {
    ensureIndexPromise = (async () => {
      const rawIndex = await fetchJson(AI_ARTICLE_INDEX_URL);
      const articleMetas = normalizeArticleList(rawIndex);

      {
        const dbRead = await openDb();
        if (!(await indexNeedsRebuild(dbRead, articleMetas))) {
          return;
        }
      }

      const extractor = await getPipeline();
      const rows = [];

      for (const meta of articleMetas) {
        const id = meta.id;
        if (!id) continue;
        const articleUrl = `${AI_ARTICLE_DIR}/${encodeURIComponent(id)}.json`;
        const a = await fetchJson(articleUrl);
        const text = [a.title, a.summary, ...(Array.isArray(a.keywords) ? a.keywords : [])]
          .filter(Boolean)
          .join("\n");
        const embedding = await embedText(extractor, text);
        rows.push({
          id: a.id || id,
          title: a.title || "",
          summary: a.summary || "",
          keywords: Array.isArray(a.keywords) ? a.keywords : [],
          embedding,
        });
      }

      /** Không giữ IDBConnection qua bước tải model/embed (lâu) — connection có thể closing → InvalidStateError */
      const dbWrite = await openDb();
      await dbClearEmbeddings(dbWrite);
      await dbPutAllEmbeddings(dbWrite, rows);
    })().catch((err) => {
      ensureIndexPromise = null;
      throw err;
    });
  }
  return ensureIndexPromise;
}

async function semanticSearch(query, { topK = 3 } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const db = await openDb();
  const all = await dbGetAllEmbeddings(db);
  if (!all.length) return [];

  const extractor = await getPipeline();
  const qVec = await embedText(extractor, q);

  const scored = all
    .map((entry) => ({
      ...entry,
      score: cosineSimilarityUnitVectors(qVec, entry.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((x) => ({
    id: x.id,
    title: x.title,
    summary: x.summary,
    keywords: x.keywords,
    score: x.score,
  }));
}

window.VSKSemanticSearch = {
  ensureSemanticIndex,
  semanticSearch,
};
window.ensureSemanticIndex = ensureSemanticIndex;
window.semanticSearch = semanticSearch;
