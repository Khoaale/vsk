/* VSK minimal PWA (vanilla JS) */

const ARTICLE_INDEX_URL = "data/articles/index.json";
const ARTICLE_DIR = "data/articles";
const IMAGE_DIR = "assets/images";

function $(sel) {
  return document.querySelector(sel);
}

function getParam(name) {
  // Prefer full URL parsing (robust with unusual servers/rewrites)
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get(name);
  if (fromQuery) return fromQuery;

  // Fallback: support `#id=...` or `#/?id=...`
  const h = (url.hash || "").replace(/^#/, "");
  if (!h) return null;
  if (h.includes("=")) return new URLSearchParams(h.replace(/^\?/, "")).get(name);
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUrgency(u) {
  if (!u) return { label: "—", cls: "" };
  const map = {
    critical: { label: "Khẩn cấp", cls: "pill--critical" },
    high: { label: "Ưu tiên cao", cls: "pill--high" },
    medium: { label: "Vừa", cls: "pill--medium" },
    low: { label: "Thấp", cls: "pill--medium" },
  };
  return map[u] || { label: u, cls: "" };
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = new URL("sw.js", location.href);
  const scopeUrl = new URL("./", document.baseURI || location.href);
  try {
    await navigator.serviceWorker.register(swUrl, { scope: scopeUrl.href });
    await requestPersistentStorage();
  } catch {
    // file://, môi trường không hỗ trợ, hoặc lỗi bảo mật
  }
}

async function requestPersistentStorage() {
  if (!("storage" in navigator) || typeof navigator.storage?.persist !== "function") {
    console.log("Storage Persistence API: Trình duyệt không hỗ trợ.");
    return;
  }

  try {
    const granted = await navigator.storage.persist();
    if (granted) {
      console.log("Storage Persistence API: Đã được cấp quyền lưu trữ vĩnh viễn.");
      return;
    }
    console.log("Storage Persistence API: Bị từ chối quyền lưu trữ.");
  } catch {
    console.log("Storage Persistence API: Bị từ chối quyền lưu trữ.");
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), waitMs);
  };
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function normalizePhone(raw) {
  const s = String(raw || "").trim();
  // keep digits and leading +
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  // only allow one leading +
  return cleaned.startsWith("+") ? "+" + cleaned.slice(1).replaceAll("+", "") : cleaned.replaceAll("+", "");
}

function renderList(articles) {
  const content = $("#panel-content");
  if (!content) return;

  if (!articles.length) {
    content.innerHTML = `<div class="hint">
      <div class="hint__title">Chưa có bài phù hợp</div>
      <div class="hint__desc">Hãy thử nhóm khác.</div>
    </div>`;
    return;
  }

  const html = articles
    .map((a) => {
      const urgency = formatUrgency(a.urgency);
      const timeframe = a.timeframe ? `<span class="pill">${escapeHtml(a.timeframe)}</span>` : "";
      const cat = a.category ? `<span class="pill">${escapeHtml(a.category)}</span>` : "";
      const urg = a.urgency
        ? `<span class="pill ${urgency.cls}">${escapeHtml(urgency.label)}</span>`
        : "";

      const u = new URL("article.html", location.href);
      u.searchParams.set("id", a.id);
      return `<a class="item" href="${escapeHtml(u.pathname + u.search)}">
        <div class="item__title">${escapeHtml(a.title)}</div>
        <div class="item__meta">${urg}${timeframe}${cat}</div>
        <div class="item__meta">${escapeHtml(a.summary || "")}</div>
      </a>`;
    })
    .join("");

  content.innerHTML = `<div class="list">${html}</div>`;
}

function renderSearchResults(containerEl, results) {
  if (!containerEl) return;

  if (!results.length) {
    containerEl.innerHTML = `<div class="search__empty">Không có kết quả phù hợp.</div>`;
    return;
  }

  const html = results
    .map((a) => {
      const u = new URL("article.html", location.href);
      u.searchParams.set("id", a.id);
      return `<a class="item" href="${escapeHtml(u.pathname + u.search)}">
        <div class="item__title">${escapeHtml(a.title || "")}</div>
        <div class="item__meta">${escapeHtml(a.summary || "")}</div>
      </a>`;
    })
    .join("");

  containerEl.innerHTML = `<div class="list">${html}</div>`;
}

/** Top‑k semantic hits (Transformers.js): id, title, summary, optional score */
function renderAISearchResults(containerEl, results) {
  if (!containerEl) return;

  const top = Array.isArray(results) ? results.slice(0, 3) : [];

  if (!top.length) {
    containerEl.innerHTML = `<div class="search__empty">Không có kết quả AI (top 3).</div>`;
    return;
  }

  const html = top
    .map((a) => {
      const id = a?.id != null ? String(a.id) : "";
      const u = new URL("article.html", location.href);
      if (id) u.searchParams.set("id", id);
      const score =
        typeof a?.score === "number" && Number.isFinite(a.score)
          ? `<span class="pill">${escapeHtml(a.score.toFixed(4))}</span>`
          : "";
      const kw =
        Array.isArray(a?.keywords) && a.keywords.length
          ? `<span class="pill">${escapeHtml(a.keywords.slice(0, 4).join(", "))}</span>`
          : "";

      return `<a class="item" href="${escapeHtml(u.pathname + u.search)}">
        <div class="item__title">${escapeHtml(a.title || id || "Bài viết")}</div>
        <div class="item__meta">${score}${kw}</div>
        <div class="item__meta">${escapeHtml(a.summary || "")}</div>
      </a>`;
    })
    .join("");

  containerEl.innerHTML = `<div class="list">${html}</div>`;
}

/**
 * Chuẩn hoá API semantic search:
 * - Ưu tiên window.VSKSemanticSearch (ensureSemanticIndex + semanticSearch)
 * - Fallback: window.semanticSearch + window.ensureSemanticIndex (hoặc tương đương)
 */
function resolveSemanticSearchApi() {
  if (
    window.VSKSemanticSearch &&
    typeof window.VSKSemanticSearch.semanticSearch === "function"
  ) {
    return window.VSKSemanticSearch;
  }

  if (typeof window.semanticSearch === "function") {
    const ensureFn =
      (typeof window.ensureSemanticIndex === "function" && window.ensureSemanticIndex.bind(window)) ||
      (typeof window.initSemanticSearch === "function" && window.initSemanticSearch.bind(window)) ||
      (typeof window.buildSemanticIndex === "function" && window.buildSemanticIndex.bind(window)) ||
      null;

    return {
      async ensureSemanticIndex() {
        if (ensureFn) await ensureFn();
      },
      semanticSearch(query, opts) {
        return window.semanticSearch(query, opts);
      },
    };
  }

  return null;
}

async function loadAllArticlesForSearch(indexList) {
  const ids = (Array.isArray(indexList) ? indexList : [])
    .map((x) => x?.id)
    .filter(Boolean);

  const uniqueIds = Array.from(new Set(ids));
  const docs = await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const a = await fetchJson(`${ARTICLE_DIR}/${encodeURIComponent(id)}.json`);
        return {
          id: a?.id || id,
          title: a?.title || "",
          summary: a?.summary || "",
          keywords: Array.isArray(a?.keywords) ? a.keywords : [],
        };
      } catch {
        // If an article file is missing, just skip it from search
        return null;
      }
    })
  );

  return docs.filter(Boolean);
}

function initNetStatus() {
  const el = document.getElementById("net-status");
  if (!el) return;

  const apply = () => {
    const online = navigator.onLine;
    el.classList.toggle("net-status--offline", !online);
    if (online) {
      el.setAttribute("aria-label", "Trực tuyến");
      el.setAttribute("title", "Mạng: trực tuyến");
    } else {
      el.setAttribute("aria-label", "Ngoại tuyến");
      el.setAttribute("title", "Mạng: ngoại tuyến");
    }
  };

  apply();
  window.addEventListener("online", apply);
  window.addEventListener("offline", apply);
}

function initInstallPrompt() {
  const btn = $("#install-btn");
  if (!btn) return;

  // If already installed (where supported), keep hidden
  const isInstalled =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (isInstalled) {
    btn.hidden = true;
    return;
  }

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    btn.disabled = true;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // ignore
    } finally {
      deferredPrompt = null;
      btn.hidden = true;
      btn.disabled = false;
    }
  });
}

function renderContactList(containerEl, contacts, { deletable }) {
  if (!containerEl) return;
  if (!contacts.length) {
    containerEl.innerHTML = `<div class="hint">
      <div class="hint__title">Chưa có số</div>
      <div class="hint__desc">Bạn có thể thêm người thân ở form phía trên.</div>
    </div>`;
    return;
  }

  const html = contacts
    .map((c, idx) => {
      const tel = normalizePhone(c.phone);
      const name = c.name || "";
      const id = c.id || `${idx}`;
      const callHref = `tel:${tel}`;
      const del =
        deletable
          ? `<button class="btn btn--tiny btn--danger" type="button" data-del="${escapeHtml(id)}">Xóa</button>`
          : "";

      return `<div class="contact">
        <div class="contact__row">
          <div>
            <div class="contact__name">${escapeHtml(name)}</div>
            <div class="contact__phone">${escapeHtml(tel)}</div>
          </div>
          ${del}
        </div>
        <div class="contact__row">
          <a class="btn btn--primary call" href="${escapeHtml(callHref)}">Gọi ngay</a>
        </div>
      </div>`;
    })
    .join("");

  containerEl.innerHTML = `<div class="contacts">${html}</div>`;
}

function initContactsPage() {
  const fixedEl = $("#contacts-fixed");
  const userEl = $("#contacts-user");
  const formEl = $("#contacts-form");
  const nameEl = $("#contact-name");
  const phoneEl = $("#contact-phone");
  const clearBtn = $("#contacts-clear");
  const subEl = $("#contacts-sub");

  if (!fixedEl || !userEl || !formEl || !nameEl || !phoneEl || !clearBtn || !subEl) return;

  const STORAGE_KEY = "vsk-contacts";
  const fixed = [
    { id: "113", name: "113 (Công an)", phone: "113" },
    { id: "114", name: "114 (Cứu hỏa)", phone: "114" },
    { id: "115", name: "115 (Cấp cứu y tế)", phone: "115" },
    { id: "111", name: "111 (Bảo vệ trẻ em)", phone: "111" },
  ];

  const saved = safeJsonParse(localStorage.getItem(STORAGE_KEY) || "[]", []);
  let user = Array.isArray(saved) ? saved : [];

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  function render() {
    renderContactList(fixedEl, fixed, { deletable: false });
    renderContactList(userEl, user, { deletable: true });
    subEl.textContent = `${fixed.length} số cố định • ${user.length} số cá nhân`;
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = String(nameEl.value || "").trim();
    const phone = normalizePhone(phoneEl.value);
    if (!name || !phone) return;
    user = [
      { id: `${Date.now()}`, name, phone },
      ...user,
    ];
    persist();
    nameEl.value = "";
    phoneEl.value = "";
    render();
  });

  userEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.getAttribute("data-del");
    if (!id) return;
    user = user.filter((c) => String(c.id) !== String(id));
    persist();
    render();
  });

  clearBtn.addEventListener("click", () => {
    user = [];
    persist();
    render();
  });

  render();
}

async function initChecklistBugoutPage() {
  const titleEl = $("#checklist-title");
  const subEl = $("#checklist-sub");
  const progressEl = $("#checklist-progress");
  const listEl = $("#checklist-list");
  const resetBtn = $("#checklist-reset");

  if (!titleEl || !subEl || !progressEl || !listEl || !resetBtn) return;

  const STORAGE_KEY = "vsk-checklist-bugout";
  const DATA_URL = "data/checklists/bug-out-bag.json";

  let data;
  try {
    data = await fetchJson(DATA_URL);
  } catch (e) {
    titleEl.textContent = "Không tải được checklist";
    subEl.textContent = e?.message || "Lỗi không xác định";
    listEl.innerHTML = `<div class="hint">
      <div class="hint__title">Không tải được dữ liệu</div>
      <div class="hint__desc">${escapeHtml(e?.message || "Lỗi không xác định")}</div>
    </div>`;
    return;
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  titleEl.textContent = data?.title || "Bug-out Bag";
  subEl.textContent = `${items.length} mục`;
  document.title = `${data?.title || "Checklist"} — VSK`;

  const saved = safeJsonParse(localStorage.getItem(STORAGE_KEY) || "{}", {});
  const state = typeof saved === "object" && saved ? { ...saved } : {};

  function computeProgress() {
    const total = items.length;
    const done = items.reduce((acc, it) => acc + (state[it.id] ? 1 : 0), 0);
    progressEl.textContent = `${percent(done, total)}%`;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function render() {
    computeProgress();
    if (!items.length) {
      listEl.innerHTML = `<div class="hint">
        <div class="hint__title">Checklist trống</div>
        <div class="hint__desc">Chưa có items trong file JSON.</div>
      </div>`;
      return;
    }

    const html = items
      .map((it) => {
        const checked = !!state[it.id];
        const id = `chk-${escapeHtml(it.id)}`;
        const labelCls = checked ? "check__label check__label--done" : "check__label";
        return `<div class="check">
          <input class="check__box" id="${id}" type="checkbox" ${checked ? "checked" : ""} />
          <label class="${labelCls}" for="${id}">${escapeHtml(it.label || "")}</label>
        </div>`;
      })
      .join("");

    listEl.innerHTML = `<div class="checklist">${html}</div>`;
  }

  listEl.addEventListener("change", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;
    const raw = target.id || "";
    const itemId = raw.startsWith("chk-") ? raw.slice(4) : "";
    if (!itemId) return;
    state[itemId] = target.checked;
    persist();
    render();
  });

  resetBtn.addEventListener("click", () => {
    for (const k of Object.keys(state)) delete state[k];
    persist();
    render();
  });

  render();
}

async function initIndexPage() {
  const btnNow = $("#btn-now");
  const btnPrep = $("#btn-prep");
  const btnReset = $("#btn-reset");
  const title = $("#panel-title");
  const searchInput = $("#search");
  const searchResults = $("#search-results");
  const searchForm = $("#search-form");

  if (!btnNow || !btnPrep || !btnReset || !title) return;

  let index;
  try {
    index = await fetchJson(ARTICLE_INDEX_URL);
  } catch (e) {
    $("#panel-content").innerHTML = `<div class="hint">
      <div class="hint__title">Không tải được dữ liệu</div>
      <div class="hint__desc">${escapeHtml(e?.message || "Lỗi không xác định")}</div>
    </div>`;
    return;
  }

  const all = Array.isArray(index?.articles) ? index.articles : [];

  // ---- Semantic search (Transformers.js) — không dùng Fuse ----
  const semanticApi = typeof window !== "undefined" ? resolveSemanticSearchApi() : null;
  let semanticInitPromise = null;

  function ensureSemanticInitialized() {
    if (!semanticApi || typeof semanticApi.ensureSemanticIndex !== "function") {
      return Promise.resolve();
    }
    if (!semanticInitPromise) {
      semanticInitPromise = Promise.resolve()
        .then(() => semanticApi.ensureSemanticIndex())
        .catch((err) => {
          semanticInitPromise = null;
          throw err;
        });
    }
    return semanticInitPromise;
  }

  /** Luôn chặn GET / ?q=… kể cả khi module AI chưa gắn API */
  let runAISearch = null;

  if (searchInput && searchResults && semanticApi && typeof semanticApi.semanticSearch === "function") {
    runAISearch = async () => {
      const q = (searchInput.value || "").trim();
      if (!q) {
        searchResults.hidden = true;
        searchResults.innerHTML = "";
        return;
      }

      searchResults.hidden = false;
      console.log("Đang tìm kiếm bằng AI...", q);

      try {
        await ensureSemanticInitialized();
        const hits = await semanticApi.semanticSearch(q, { topK: 3 });
        console.log("Kết quả AI:", hits);
        renderAISearchResults(searchResults, hits);
      } catch (e) {
        console.error("Semantic search lỗi:", e);
        searchResults.innerHTML = `<div class="search__empty">Lỗi semantic search: ${escapeHtml(
          e?.message || "Không xác định"
        )}</div>`;
      }
    };

    const debouncedRun = debounce(() => {
      void runAISearch();
    }, 250);

    searchInput.addEventListener("input", debouncedRun);

    void ensureSemanticInitialized().catch((err) => {
      console.warn("Không khởi tạo được chỉ mục semantic:", err);
    });
  } else if (searchInput && searchResults && !semanticApi) {
    console.warn(
      "Không có semantic API: gán window.VSKSemanticSearch hoặc window.semanticSearch (+ ensureSemanticIndex)."
    );
  }

  if (searchForm && searchInput && searchResults) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (typeof runAISearch === "function") void runAISearch();
    });
  }

  function show(group) {
    btnReset.hidden = false;
    if (group === "now") {
      title.textContent = "Đang xảy ra ngay";
      renderList(all.filter((a) => a.category === "emergency"));
      return;
    }
    if (group === "prep") {
      title.textContent = "Chuẩn bị trước";
      renderList(all.filter((a) => a.category !== "emergency"));
      return;
    }
  }

  btnNow.addEventListener("click", () => show("now"));
  btnPrep.addEventListener("click", () => show("prep"));
  btnReset.addEventListener("click", () => {
    btnReset.hidden = true;
    title.textContent = "Gợi ý";
    $("#panel-content").innerHTML = `<div class="hint">
      <div class="hint__title">Chọn một nhóm</div>
      <div class="hint__desc">Nhấn “Đang xảy ra ngay” hoặc “Chuẩn bị trước”.</div>
    </div>`;
  });
}

function stepToHtml(step) {
  const t = escapeHtml(step?.title || "");
  const b = escapeHtml(step?.body || "");
  const w = step?.warning ? escapeHtml(step.warning) : "";

  const imgName = step?.image ? String(step.image) : "";
  const imgSrc = imgName ? `${IMAGE_DIR}/${encodeURIComponent(imgName)}` : "";
  const img = imgSrc
    ? `<img class="step__img" src="${imgSrc}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";

  const warn = w ? `<div class="step__warn">${w}</div>` : "";

  return `<article class="step">
    <div class="step__body">
      <h2 class="step__title">${t}</h2>
      <p class="step__text">${b}</p>
      ${warn}
    </div>
    ${img}
  </article>`;
}

async function initArticlePage() {
  const titleEl = $("#article-title");
  const summaryEl = $("#article-summary");
  const stepsEl = $("#steps");
  const metaEl = $("#article-meta");

  if (!titleEl || !summaryEl || !stepsEl || !metaEl) return;

  const id = getParam("id");
  if (!id) {
    titleEl.textContent = "Thiếu tham số bài viết";
    summaryEl.textContent = "Hãy mở bài từ trang chủ.";
    return;
  }

  let article;
  try {
    article = await fetchJson(`${ARTICLE_DIR}/${encodeURIComponent(id)}.json`);
  } catch (e) {
    titleEl.textContent = "Không tải được bài viết";
    summaryEl.textContent = e?.message || "Lỗi không xác định";
    return;
  }

  document.title = `${article?.title || "Bài hướng dẫn"} — VSK`;
  titleEl.textContent = article?.title || "Bài hướng dẫn";
  summaryEl.textContent = article?.summary || "";

  const urgency = formatUrgency(article?.urgency);
  const metaParts = [];
  if (article?.timeframe) metaParts.push(article.timeframe);
  if (article?.category) metaParts.push(article.category);
  if (article?.urgency) metaParts.push(urgency.label);
  metaEl.textContent = metaParts.filter(Boolean).join(" • ") || "Hướng dẫn";

  const steps = Array.isArray(article?.steps) ? article.steps : [];
  stepsEl.innerHTML = steps.map(stepToHtml).join("") || `<div class="hint">
    <div class="hint__title">Chưa có nội dung</div>
    <div class="hint__desc">Bài viết này chưa có các bước hướng dẫn.</div>
  </div>`;
}

registerSW();
initNetStatus();
initIndexPage();
initArticlePage();
initChecklistBugoutPage();
initContactsPage();
initInstallPrompt();

