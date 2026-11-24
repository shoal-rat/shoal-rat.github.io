/* 观潮 Tidewatch — page telemetry for weikezhang.cn.
   Sends page views, time on page, scroll depth, clicks, performance and
   errors to the Tidewatch worker. The visitor id is a random UUID kept in
   localStorage and in a first-party cookie (tw_v) so return visits are recognised.
   URL switches:  ?tidewatch=me   mark this browser as the site owner
                  ?tidewatch=off  undo that
                  ?tidewatch=preview  do not record this page load        */
(function () {
  "use strict";
  if (window.__tidewatch) return;
  window.__tidewatch = true;

  var VERSION = 1;
  var SESSION_GAP = 30 * 60 * 1000;
  var IDLE_AFTER = 60 * 1000;
  var BEAT_EVERY = 20 * 1000;
  var BEAT_FOR = 45 * 60 * 1000;
  var PROD_HOSTS = { "weikezhang.cn": 1, "www.weikezhang.cn": 1, "shoal-rat.github.io": 1 };

  var store = safeStorage("localStorage");
  var tabStore = safeStorage("sessionStorage");
  var params = new URLSearchParams(location.search);
  var switchParam = params.get("tidewatch");

  if (switchParam === "me") store.set("tw_owner", "1");
  if (switchParam === "off") store.del("tw_owner");
  if (switchParam === "me" || switchParam === "off") {
    params.delete("tidewatch");
    var clean = location.pathname + (params.toString() ? "?" + params : "") + location.hash;
    try { history.replaceState(history.state, "", clean); } catch (_) {}
  }
  if (switchParam === "preview") return;
  if (window.top !== window.self && /\/\/tide\./.test(document.referrer)) return;

  var endpoint = PROD_HOSTS[location.hostname]
    ? "https://tide.weikezhang.cn/e"
    : store.get("tw_endpoint");
  if (!endpoint) return;

  /* ---------- ids ---------- */
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  /* Identity lives in two places so a returning visitor is still recognised when one
     is wiped: localStorage, and a first-party cookie "tw_v" shared by *.weikezhang.cn
     (vid.firstSeen.visitCount.lastActivity). Safari caps both at 7 days without a visit. */
  var ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var COOKIE_DOMAIN = /(^|\.)weikezhang\.cn$/.test(location.hostname) ? "; domain=weikezhang.cn" : "";
  function readCookie() {
    var m = document.cookie.match(/(?:^|;\s*)tw_v=([^;]+)/);
    if (!m) return null;
    var p = decodeURIComponent(m[1]).split(".");
    if (!ID_RE.test(p[0])) return null;
    return { vid: p[0], first: Number(p[1]) || 0, n: Number(p[2]) || 0, last: Number(p[3]) || 0 };
  }
  function writeCookie() {
    try {
      document.cookie = "tw_v=" + [vid, firstSeen, visitNo, lastActive].join(".") +
        "; path=/; max-age=34560000; samesite=lax" + (location.protocol === "https:" ? "; secure" : "") + COOKIE_DOMAIN;
    } catch (_) {}
  }

  var now = Date.now();
  var lsVid = store.get("tw_vid");
  if (lsVid && !ID_RE.test(lsVid)) lsVid = null;
  var lsFirst = Number(store.get("tw_first")) || 0;
  var ck = readCookie();
  var idSource = (lsVid ? 1 : 0) + (ck ? 2 : 0); // 0 new browser, 1 storage only, 2 cookie only, 3 both
  var vid = lsVid || (ck && ck.vid) || uid();
  if (lsVid && ck && ck.vid !== lsVid && ck.first && (!lsFirst || ck.first < lsFirst)) vid = ck.vid; // keep the older identity
  var firstSeen = Math.min.apply(null, [lsFirst, ck ? ck.first : 0, now].filter(function (x) { return x > 0; }));
  var visitNo = Math.max(Number(store.get("tw_n")) || 0, ck ? ck.n : 0);
  var lastActive = Math.max(Number(store.get("tw_last")) || 0, ck ? ck.last : 0);

  var sess = readJSON(store.get("tw_s"));
  var newSession = !sess || !sess.id || now - (sess.last || 0) > SESSION_GAP;
  if (sess && sess.last > lastActive) lastActive = sess.last;
  var sinceLast = 0;
  if (newSession) {
    sinceLast = visitNo > 0 && lastActive > 0 && lastActive < now ? now - lastActive : 0;
    visitNo += 1;
    sess = { id: uid(), last: now, seq: 0 };
  }
  lastActive = now;
  store.set("tw_vid", vid);
  store.set("tw_first", String(firstSeen));
  store.set("tw_n", String(visitNo));
  store.set("tw_last", String(lastActive));
  writeCookie();
  function touch() {
    lastActive = Date.now();
    sess.last = lastActive;
    store.set("tw_s", JSON.stringify(sess));
    store.set("tw_last", String(lastActive));
    writeCookie();
  }
  var owner = store.get("tw_owner") === "1" ? 1 : 0;

  /* ---------- transport ---------- */
  var outbox = [];
  function send(msg) { outbox.push(msg); }
  function flush() {
    if (!outbox.length) return;
    var body = JSON.stringify(outbox);
    outbox = [];
    var ok = false;
    try { ok = navigator.sendBeacon && navigator.sendBeacon(endpoint, body); } catch (_) {}
    if (!ok) {
      try {
        fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "no-cors", credentials: "include" });
      } catch (_) {}
    }
  }

  /* ---------- environment (once per page) ---------- */
  function env() {
    var n = navigator, s = screen, c = n.connection || n.mozConnection || n.webkitConnection || {};
    var mq = function (q) { try { return matchMedia(q).matches; } catch (_) { return false; } };
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
    return {
      sw: s.width, sh: s.height, aw: s.availWidth, ah: s.availHeight,
      vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1, cd: s.colorDepth,
      or: (s.orientation && s.orientation.type) || "",
      tp: n.maxTouchPoints || 0, hc: n.hardwareConcurrency || 0, dm: n.deviceMemory || 0,
      la: n.language || "", ls: (n.languages || []).slice(0, 6).join(","),
      tz: tz, to: -new Date().getTimezoneOffset(),
      cs: mq("(prefers-color-scheme: dark)") ? "dark" : mq("(prefers-color-scheme: light)") ? "light" : "",
      rm: mq("(prefers-reduced-motion: reduce)") ? 1 : 0,
      ct: c.effectiveType || "", nt: c.type || "", dl: c.downlink || 0, rt: c.rtt || 0, sd: c.saveData ? 1 : 0,
      dnt: n.doNotTrack === "1" || window.doNotTrack === "1" ? 1 : 0,
      gpc: n.globalPrivacyControl ? 1 : 0,
      ck: n.cookieEnabled ? 1 : 0, wd: n.webdriver ? 1 : 0, pdf: n.pdfViewerEnabled ? 1 : 0
    };
  }

  /* ---------- page view state ---------- */
  var pv = null;
  function startView(navType) {
    sess.seq = (sess.seq || 0) + 1;
    touch();
    var prev = tabStore.get("tw_prev") || "";
    pv = {
      id: uid(), path: location.pathname, vis: 0, act: 0, scroll: 0,
      started: Date.now(), events: [], clicks: [], ended: false
    };
    tabStore.set("tw_prev", location.pathname);
    send({
      t: "pv", v: VERSION, vid: vid, sid: sess.id, pv: pv.id, seq: sess.seq,
      ns: newSession ? 1 : 0, vn: visitNo, fs: firstSeen, own: owner, ids: idSource, gp: sinceLast,
      u: location.pathname + location.search + location.hash,
      ti: (document.title || "").slice(0, 200),
      r: navType === "spa" ? "" : document.referrer || "",
      pp: prev, nt: navType, env: env()
    });
    newSession = false;
    measureScroll();
    flush();
  }

  /* ---------- time on page ---------- */
  var lastTick = Date.now();
  var lastInput = Date.now();
  function markInput() { lastInput = Date.now(); }
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"].forEach(function (t) {
    addEventListener(t, markInput, { passive: true, capture: true });
  });
  setInterval(function () {
    var t = Date.now(), dt = Math.min(t - lastTick, 2000);
    lastTick = t;
    if (!pv || document.visibilityState !== "visible") return;
    pv.vis += dt;
    if (document.hasFocus() && t - lastInput < IDLE_AFTER) pv.act += dt;
  }, 1000);

  /* ---------- scroll depth ---------- */
  var scrollQueued = false;
  function measureScroll() {
    scrollQueued = false;
    if (!pv) return;
    var d = document.documentElement, b = document.body;
    var h = Math.max(d.scrollHeight, b ? b.scrollHeight : 0);
    var seen = (window.scrollY || d.scrollTop || 0) + innerHeight;
    var pct = h > 0 ? Math.min(100, Math.round((seen / h) * 100)) : 100;
    if (pct > pv.scroll) pv.scroll = pct;
  }
  addEventListener("scroll", function () {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(measureScroll); }
  }, { passive: true });

  /* ---------- performance ---------- */
  var perf = {};
  function observe(type, cb, opts) {
    try {
      var po = new PerformanceObserver(function (list) { list.getEntries().forEach(cb); });
      po.observe(Object.assign({ type: type, buffered: true }, opts || {}));
    } catch (_) {}
  }
  observe("paint", function (e) { if (e.name === "first-contentful-paint") perf.fcp = Math.round(e.startTime); });
  observe("largest-contentful-paint", function (e) { perf.lcp = Math.round(e.startTime); });
  var clsWin = 0, clsFirst = 0, clsLast = 0;
  observe("layout-shift", function (e) {
    if (e.hadRecentInput) return;
    if (clsWin && e.startTime - clsLast < 1000 && e.startTime - clsFirst < 5000) clsWin += e.value;
    else { clsWin = e.value; clsFirst = e.startTime; }
    clsLast = e.startTime;
    if (!perf.cls || clsWin > perf.cls) perf.cls = Math.round(clsWin * 10000) / 10000;
  });
  observe("event", function (e) {
    if (e.interactionId && (!perf.inp || e.duration > perf.inp)) perf.inp = Math.round(e.duration);
  }, { durationThreshold: 16 });
  observe("longtask", function () { perf.lt = (perf.lt || 0) + 1; });
  function navTiming() {
    var n = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (!n) return;
    perf.ttfb = Math.round(n.responseStart);
    perf.dcl = Math.round(n.domContentLoadedEventEnd);
    if (n.loadEventEnd) perf.load = Math.round(n.loadEventEnd);
    perf.dns = Math.round(n.domainLookupEnd - n.domainLookupStart);
    perf.tcp = Math.round(n.connectEnd - n.connectStart);
    perf.tls = n.secureConnectionStart > 0 ? Math.round(n.connectEnd - n.secureConnectionStart) : 0;
    perf.tr = n.transferSize || 0;
    perf.pr = n.nextHopProtocol || "";
  }
  function navType() {
    try {
      var n = performance.getEntriesByType("navigation")[0];
      if (n && n.type) return n.type;
    } catch (_) {}
    return "navigate";
  }

  /* ---------- events ---------- */
  function track(type, name, value, meta) {
    if (!pv || pv.events.length > 200) return;
    pv.events.push([type, clip(name, 200), clip(value, 600), meta ? clip(JSON.stringify(meta), 1500) : null, Date.now() - pv.started]);
  }
  window.tidewatch = { track: function (name, value) { track("custom", String(name), value == null ? "" : String(value)); } };

  function describe(el) {
    if (!el || !el.tagName) return "";
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    var cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    if (cls) s += "." + cls;
    return s.slice(0, 120);
  }
  var DOWNLOAD = /\.(pdf|zip|rar|7z|gz|tgz|dmg|pkg|exe|msi|apk|ipa|epub|mobi|docx?|xlsx?|pptx?|csv|mp4|mov|mp3|wav|flac|whl)(\?|#|$)/i;
  var recent = [];
  function onClick(e) {
    if (!pv) return;
    var target = e.target && e.target.closest ? e.target : null;
    if (!target) return;
    var hit = target.closest("a,button,[role=button],input,select,textarea,summary,label") || target;
    var link = target.closest("a[href]");
    var d = document.documentElement;
    if (e.type === "click" && pv.clicks.length < 300) {
      pv.clicks.push([
        Math.round(e.pageX), Math.round(e.pageY), d.scrollWidth, Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0),
        innerWidth, describe(hit), clip((hit.innerText || hit.value || hit.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "), 80),
        link ? clip(link.href, 300) : ""
      ]);
    }
    if (link) {
      var href = link.href, url;
      try { url = new URL(href, location.href); } catch (_) { url = null; }
      if (url && (url.protocol === "mailto:" || url.protocol === "tel:")) track("contact", url.protocol.slice(0, -1), href);
      else if (url && link.hasAttribute("download") || DOWNLOAD.test(href)) track("download", url ? url.pathname.split("/").pop() : "", href);
      else if (url && url.host && url.host !== location.host) track("outbound", url.host, href, { text: clip((link.innerText || "").trim(), 80) });
    }
    if (e.type !== "click") return;
    var t = Date.now();
    recent = recent.filter(function (r) { return t - r[0] < 800; });
    recent.push([t, e.clientX, e.clientY]);
    var near = recent.filter(function (r) { return Math.abs(r[1] - e.clientX) < 40 && Math.abs(r[2] - e.clientY) < 40; });
    if (near.length === 3) track("rage", describe(hit), clip((hit.innerText || "").trim(), 80));
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);

  document.addEventListener("copy", function () {
    var text = String(window.getSelection ? getSelection() : "").trim();
    if (text) track("copy", String(text.length), clip(text, 160));
  }, true);

  // site terminal (js/lab.js): read the command before the terminal clears it
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !e.target || !e.target.closest) return;
    if (!e.target.closest(".lab-terminal")) return;
    var cmd = String(e.target.value || e.target.textContent || "").trim();
    if (cmd) track("terminal", cmd.split(/\s+/)[0].toLowerCase(), clip(cmd, 200));
  }, true);

  // site search panel
  var searchTimer = 0, lastQuery = "";
  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.matches || !e.target.matches("[data-search-input], input[type=search]")) return;
    clearTimeout(searchTimer);
    var field = e.target;
    searchTimer = setTimeout(function () {
      var q = String(field.value || "").trim();
      if (q.length < 2 || q === lastQuery) return;
      lastQuery = q;
      var box = document.querySelector("[data-search-results]");
      track("search", clip(q, 120), box ? String(box.children.length) : "");
    }, 1200);
  }, true);

  addEventListener("error", function (e) {
    if (e instanceof ErrorEvent || e.message) {
      track("js_error", e.message || "error", (e.filename || "") + ":" + (e.lineno || 0) + ":" + (e.colno || 0),
        e.error && e.error.stack ? { stack: clip(String(e.error.stack), 900) } : null);
    } else if (e.target && e.target !== window && e.target.tagName) {
      track("res_error", e.target.tagName.toLowerCase(), e.target.currentSrc || e.target.src || e.target.href || "");
    }
  }, true);
  addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    track("js_error", r && r.message ? r.message : String(r), "promise", r && r.stack ? { stack: clip(String(r.stack), 900) } : null);
  });
  document.addEventListener("play", function (e) {
    var m = e.target;
    if (m && m.tagName) track("media", m.tagName.toLowerCase(), m.currentSrc || m.src || "");
  }, true);
  document.addEventListener("submit", function (e) {
    var f = e.target;
    track("form", describe(f), f && f.action ? f.action : "");
  }, true);
  addEventListener("beforeprint", function () { track("print", document.title, ""); });
  addEventListener("hashchange", function () { track("anchor", location.hash.slice(0, 120), ""); });
  document.addEventListener("fullscreenchange", function () {
    if (document.fullscreenElement) track("fullscreen", describe(document.fullscreenElement), "");
  });

  /* ---------- reporting ---------- */
  function report(final) {
    if (!pv || pv.ended) return;
    measureScroll();
    navTiming();
    var d = document.documentElement;
    send({
      t: "up", vid: vid, sid: sess.id, pv: pv.id, own: owner,
      vis: pv.vis, act: pv.act, sc: pv.scroll,
      dh: Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0),
      perf: perf, ev: pv.events.splice(0), ck: pv.clicks.splice(0), end: final ? 1 : 0
    });
    if (final) pv.ended = true;
    touch();
    flush();
  }
  setInterval(function () {
    if (!pv || document.visibilityState !== "visible") return;
    if (Date.now() - pv.started > BEAT_FOR) return;
    report(false);
  }, BEAT_EVERY);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") report(false);
    else if (pv && pv.ended) { /* came back from bfcache */ }
  });
  addEventListener("pagehide", function () { report(true); });
  addEventListener("pageshow", function (e) {
    if (e.persisted) { perf = {}; startView("back_forward"); }
  });

  // single-page apps that change the path with history.pushState
  function onRoute() {
    if (pv && location.pathname !== pv.path) { report(true); perf = {}; startView("spa"); }
  }
  ["pushState", "replaceState"].forEach(function (k) {
    var orig = history[k];
    if (typeof orig !== "function") return;
    history[k] = function () { var r = orig.apply(this, arguments); setTimeout(onRoute, 0); return r; };
  });
  addEventListener("popstate", onRoute);

  /* ---------- one-time device details (async) ---------- */
  function deviceDetails() {
    var out = { t: "dev", vid: vid, sid: sess.id };
    try {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (gl) {
        var ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          out.gpu = clip(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), 200);
          out.gv = clip(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), 100);
        }
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    } catch (_) {}
    var ua = navigator.userAgentData;
    if (ua && ua.getHighEntropyValues) {
      ua.getHighEntropyValues(["platform", "platformVersion", "architecture", "bitness", "model", "fullVersionList"])
        .then(function (v) { out.ch = v; send(out); flush(); })
        .catch(function () { send(out); flush(); });
    } else { send(out); flush(); }
  }

  /* ---------- helpers ---------- */
  function clip(s, n) { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) : s; }
  function readJSON(s) { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } }
  function safeStorage(kind) {
    var mem = {}, st = null;
    try { st = window[kind]; st.setItem("tw_t", "1"); st.removeItem("tw_t"); } catch (_) { st = null; }
    return {
      get: function (k) { try { return st ? st.getItem(k) : mem[k] || null; } catch (_) { return mem[k] || null; } },
      set: function (k, v) { try { if (st) st.setItem(k, v); else mem[k] = v; } catch (_) { mem[k] = v; } },
      del: function (k) { try { if (st) st.removeItem(k); delete mem[k]; } catch (_) {} }
    };
  }

  /* ---------- go ---------- */
  startView(navType());
  if (sess.seq === 1 || !tabStore.get("tw_dev_" + sess.id)) {
    tabStore.set("tw_dev_" + sess.id, "1");
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1500); };
    idle(deviceDetails, { timeout: 4000 });
  }
})();
