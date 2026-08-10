(function () {
  const panel = document.querySelector("[data-search-panel]");
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  if (!panel || !input || !results) return;
  let index = [];

  function clean(text) {
    return String(text || "").replace(/[#>*_\`\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  }

  function render(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '<span>Type a query to scan the notes.</span>';
      return;
    }
    const matches = index
      .filter((item) => (item.title + " " + item.content + " " + (item.tags || []).join(" ") + " " + (item.categories || []).join(" ")).toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) {
      results.innerHTML = '<span>No matching signal.</span>';
      return;
    }
    results.innerHTML = matches.map((item) => {
      const summary = clean(item.content).slice(0, 150);
      return '<a href="' + item.url + '"><strong>' + item.title + '</strong><span>' + summary + '...</span></a>';
    }).join("");
  }

  function openSearch() {
    panel.hidden = false;
    document.body.style.overflow = "hidden";
    if (!index.length) {
      fetch("/search.json").then((response) => response.json()).then((data) => {
        index = data;
        render(input.value);
      }).catch(() => {
        results.innerHTML = '<span>Search index unavailable.</span>';
      });
    } else {
      render(input.value);
    }
    window.setTimeout(() => input.focus(), 0);
  }

  function closeSearch() {
    panel.hidden = true;
    document.body.style.overflow = "";
  }

  document.addEventListener("click", (event) => {
    const open = event.target.closest("[data-search-open]");
    const close = event.target.closest("[data-search-close]");
    if (open) openSearch();
    if (close) closeSearch();
    if (event.target === panel) closeSearch();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closeSearch();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });

  input.addEventListener("input", () => render(input.value));
})();
/* --- zen-hacker layer ------------------------------------------------- */

/* "/" opens search (unless already typing somewhere) */
(function () {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const opener = document.querySelector("[data-search-open]");
    if (!opener) return;
    event.preventDefault();
    opener.click();
  });
})();

/* One shared terminal, mounted in the hero on home and directly below the
   intro everywhere else. It is deliberately built here so generated article,
   archive, taxonomy and 404 pages all receive the same current command set. */
(function () {
  const ROUTES = Object.freeze({
    home: "/",
    aboutme: "/aboutme/",
    projects: "/projects/",
    archives: "/archives/",
    tags: "/tags/",
    categories: "/categories/",
    resources: "/resources/",
    lively: "/lively/",
    trips: "/trip-memory-map/",
  });
  const ROUTE_ALIASES = Object.freeze({
    about: "aboutme", archive: "archives", project: "projects",
    map: "trips", trip: "trips",
  });
  const KOANS = [
    "潮起潮落，代码常新。",
    "the wave returns to the sea.",
    "格物致知，即物穷理。",
    "no signal is also a signal.",
    "empty stack, quiet mind.",
  ];

  function hasRoute(key) {
    return Object.prototype.hasOwnProperty.call(ROUTES, key);
  }

  function resolveRoute(key) {
    return Object.prototype.hasOwnProperty.call(ROUTE_ALIASES, key) ? ROUTE_ALIASES[key] : key;
  }

  function promptPath() {
    let pathname = window.location.pathname;
    try { pathname = decodeURIComponent(pathname); } catch (_) {}
    const path = pathname.replace(/^\/+|\/+$/g, "");
    if (!path) return "~";
    const route = Object.keys(ROUTES).find((key) => ROUTES[key].replace(/^\/+|\/+$/g, "") === path);
    if (route) return "~/" + route;
    const parts = path.split("/").filter(Boolean);
    if (/^\d{4}$/.test(parts[0] || "") && parts.length > 3) return "~/notes/" + parts[parts.length - 1];
    return "~/" + parts.slice(-2).join("/");
  }

  function makePrompt() {
    const prompt = document.createElement("span");
    prompt.className = "terminal-prompt";
    const user = document.createElement("span");
    user.className = "terminal-user";
    user.textContent = "shoal@rat";
    const divider = document.createElement("span");
    divider.className = "terminal-divider";
    divider.textContent = ":";
    const path = document.createElement("span");
    path.className = "terminal-path";
    path.textContent = promptPath();
    path.title = path.textContent;
    const mark = document.createElement("span");
    mark.className = "terminal-mark";
    mark.textContent = "$";
    prompt.append(user, divider, path, mark);
    return prompt;
  }

  let host = document.querySelector(".hero-console");
  let shellSection = null;
  const isHero = Boolean(host);
  const isStandalone = document.body.hasAttribute("data-site-terminal-standalone");
  if (!host) {
    const main = document.querySelector("main");
    const section = document.createElement("section");
    section.className = "site-terminal-section";
    section.setAttribute("aria-label", "Site terminal");
    shellSection = section;
    host = document.createElement("div");
    host.className = "lab-terminal";
    section.append(host);
    if (isStandalone) {
      section.classList.add("is-standalone-terminal", "is-collapsed");
      document.body.append(section);
    } else {
      if (!main) return;
      const intro = main.querySelector(":scope > .page-intro");
      if (intro) intro.insertAdjacentElement("afterend", section);
      else main.insertAdjacentElement("afterbegin", section);
    }
  }

  host.classList.add("lab-terminal", "is-live");
  if (isHero) host.classList.add("is-hero-terminal");
  if (isStandalone) host.classList.add("is-standalone-terminal", "is-collapsed");
  host.setAttribute("aria-label", 'Site terminal. Type "help" for commands.');
  host.innerHTML = "";

  const chrome = document.createElement("div");
  chrome.className = "terminal-chrome";
  const lights = document.createElement("span");
  lights.className = "terminal-lights";
  lights.setAttribute("aria-hidden", "true");
  lights.innerHTML = "<i></i><i></i><i></i>";
  const title = document.createElement("span");
  title.className = "terminal-window-title";
  title.textContent = "shoal@rat — zsh";
  const shortcut = document.createElement("kbd");
  shortcut.textContent = "Ctrl + `";
  const toggle = document.createElement("button");
  toggle.className = "terminal-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", String(!isStandalone));
  toggle.setAttribute("aria-label", isStandalone ? "Open site terminal" : "Minimize site terminal");
  toggle.setAttribute("aria-controls", "site-terminal-screen");
  toggle.textContent = isStandalone ? "+" : "−";
  chrome.append(lights, title, shortcut, toggle);

  const screen = document.createElement("div");
  screen.className = "terminal-screen";
  screen.id = "site-terminal-screen";
  const out = document.createElement("div");
  out.className = "console-out";
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  out.setAttribute("aria-relevant", "additions");

  const row = document.createElement("div");
  row.className = "console-input-row";
  row.append(makePrompt());
  const inputShell = document.createElement("span");
  inputShell.className = "terminal-input-shell";
  const field = document.createElement("input");
  field.className = "console-field";
  field.type = "text";
  field.autocomplete = "off";
  field.autocapitalize = "off";
  field.spellcheck = false;
  field.placeholder = 'type "help"';
  field.setAttribute("aria-label", 'Terminal command. Type "help" for commands.');
  const measure = document.createElement("span");
  measure.className = "terminal-input-measure";
  measure.setAttribute("aria-hidden", "true");
  const cursor = document.createElement("span");
  cursor.className = "terminal-block-cursor";
  cursor.setAttribute("aria-hidden", "true");
  inputShell.append(field, measure, cursor);
  row.append(inputShell);
  screen.append(out, row);
  host.append(chrome, screen);

  let history = [];
  try {
    const saved = JSON.parse(window.sessionStorage.getItem("shoal-terminal-history") || "[]");
    if (Array.isArray(saved)) history = saved.filter((item) => typeof item === "string").slice(-50);
  } catch (_) {}
  let historyIndex = history.length;
  let historyDraft = "";
  let scrollQueued = false;

  function scrollToLatest() {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(() => {
      screen.scrollTop = screen.scrollHeight;
      scrollQueued = false;
    });
  }

  function trimOutput() {
    const limit = isHero ? 8 : 12;
    while (out.children.length > limit) out.removeChild(out.firstChild);
  }

  function print(text, cls) {
    const line = document.createElement("div");
    line.className = "console-line" + (cls ? " " + cls : "");
    line.textContent = text;
    out.append(line);
    trimOutput();
    scrollToLatest();
  }

  function printCommand(text) {
    const line = document.createElement("div");
    line.className = "console-line is-cmd";
    line.append(makePrompt());
    const command = document.createElement("span");
    command.className = "terminal-command";
    command.textContent = text;
    line.append(command);
    out.append(line);
    trimOutput();
    scrollToLatest();
  }

  function navigate(rawTarget) {
    const requested = String(rawTarget || "").trim();
    let target = requested.toLowerCase().replace(/^~?\/+/, "").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!target && /^~?\/+$/i.test(requested)) target = "home";
    target = resolveRoute(target);
    if (target === ".." || target === "~") target = "home";
    if (target === "github") {
      print("opening github.com/shoal-rat", "is-success");
      window.open("https://github.com/shoal-rat", "_blank", "noopener");
      return;
    }
    if (!hasRoute(target)) {
      print("cd: no such place: " + (rawTarget || "(empty)"), "is-error");
      return;
    }
    print("→ " + ROUTES[target], "is-success");
    window.location.assign(ROUTES[target]);
  }

  function execute(raw) {
    const value = raw.trim();
    if (!value) return;
    const parts = value.split(/\s+/);
    const cmd = (parts.shift() || "").toLowerCase();
    const arg = (parts[0] || "").toLowerCase();
    printCommand(value);

    if (hasRoute(resolveRoute(cmd))) {
      navigate(cmd);
      return;
    }

    switch (cmd) {
      case "help":
        print("commands  ls · pwd · open/cd/go <place> · back · history · whoami · date · echo · wake · still · zen · clear", "is-info");
        print("places    home · aboutme · projects · archives · tags · categories · resources · lively · trips · github", "is-quiet");
        break;
      case "ls":
        print("aboutme/  projects/  archives/  tags/  categories/  resources/  lively/  trips/", "is-info");
        break;
      case "pwd":
        print("/home/shoal/site" + window.location.pathname, "is-success");
        break;
      case "open":
      case "cd":
      case "go":
        if (!arg) print("usage: " + cmd + " <place> — try `cd projects`", "is-error");
        else navigate(arg);
        break;
      case "github":
        navigate("github");
        break;
      case "back":
        print("← browser history", "is-success");
        window.history.back();
        break;
      case "history":
        {
          const start = Math.max(0, history.length - 10);
          history.slice(start).forEach((item, index) => print(String(start + index + 1).padStart(3, " ") + "  " + item, "is-quiet"));
        }
        break;
      case "whoami":
        print("shoal rat — econ × cs × ai, learning in public.", "is-success");
        break;
      case "date":
        print(new Date().toLocaleString(undefined, { dateStyle: "full", timeStyle: "medium" }), "is-success");
        break;
      case "echo":
        print(parts.join(" "));
        break;
      case "zen":
        print(KOANS[Math.floor(Math.random() * KOANS.length)], "is-success");
        break;
      case "clear":
        out.innerHTML = "";
        break;
      case "wake": {
        const result = window.__setSea ? window.__setSea(true) : false;
        if (result === true) print("the wave runs; the fish leap.", "is-success");
        else if (result === "busy") print("the sea is already in motion.", "is-quiet");
        else if (result === "loading") print("the woodblock layers are still drying.", "is-quiet");
        else if (result === "unavailable") print("ocean renderer unavailable; the static print remains.", "is-error");
        else if (result === "reduced") print("reduced motion: a quiet tide only.", "is-quiet");
        else print("ocean controller: cd home", "is-quiet");
        break;
      }
      case "still":
      case "sleep": {
        const result = window.__setSea ? window.__setSea(false) : false;
        if (result === "settled" || result === "settling") print("the sea is still.", "is-quiet");
        else if (result === "loading") print("the woodblock layers are still drying.", "is-quiet");
        else if (result === "unavailable") print("ocean renderer unavailable; the static print remains.", "is-error");
        else print("the sea is already still.", "is-quiet");
        break;
      }
      case "sudo":
        print("permission denied: the sea does not take orders.", "is-error");
        break;
      default:
        print("zsh: command not found: " + cmd + " — try `help`", "is-error");
    }
  }

  function syncCursor() {
    const end = typeof field.selectionStart === "number" ? field.selectionStart : field.value.length;
    measure.textContent = field.value.slice(0, end).replace(/ /g, "\u00a0");
    window.requestAnimationFrame(() => {
      const measured = measure.getBoundingClientRect().width - field.scrollLeft;
      const bounded = Math.max(0, Math.min(measured, inputShell.clientWidth - 10));
      inputShell.style.setProperty("--cursor-x", bounded + "px");
    });
  }

  function useHistory(nextIndex) {
    historyIndex = Math.max(0, Math.min(history.length, nextIndex));
    field.value = historyIndex === history.length ? historyDraft : history[historyIndex];
    field.setSelectionRange(field.value.length, field.value.length);
    syncCursor();
  }

  field.addEventListener("input", syncCursor);
  field.addEventListener("click", syncCursor);
  field.addEventListener("keyup", syncCursor);
  field.addEventListener("scroll", syncCursor);
  field.addEventListener("select", syncCursor);
  field.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      const value = field.value;
      if (value.trim()) {
        history.push(value.trim());
        history = history.slice(-50);
        try { window.sessionStorage.setItem("shoal-terminal-history", JSON.stringify(history)); } catch (_) {}
      }
      historyIndex = history.length;
      historyDraft = "";
      execute(value);
      field.value = "";
      syncCursor();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (historyIndex === history.length) historyDraft = field.value;
      useHistory(historyIndex - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      useHistory(historyIndex + 1);
    } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      out.innerHTML = "";
    } else if (event.ctrlKey && event.key.toLowerCase() === "c" && field.selectionStart === field.selectionEnd) {
      event.preventDefault();
      field.value = "";
      print("^C", "is-quiet");
      syncCursor();
    }
  });

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const collapsed = host.classList.toggle("is-collapsed");
    if (shellSection) shellSection.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Open site terminal" : "Minimize site terminal");
    toggle.textContent = collapsed ? "+" : "−";
    if (!collapsed) window.setTimeout(() => field.focus(), 0);
  });

  host.addEventListener("click", (event) => {
    if (!event.target.closest(".console-out, button, kbd")) field.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.code === "Backquote") {
      event.preventDefault();
      if (host.classList.contains("is-collapsed")) toggle.click();
      const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      window.setTimeout(() => field.focus(), reduceMotion ? 0 : 180);
    }
  });

  if (isHero) {
    printCommand("git status --short");
    print("notes indexed / search local / stack econ+cs+ai", "is-success");
  } else {
    print("session attached · type `help` · ↑/↓ history · Ctrl+L clears", "is-quiet");
    print("cwd  " + promptPath(), "is-success");
  }
  syncCursor();
})();

/* Below-the-fold cards breathe in once as they arrive */
(function () {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!("IntersectionObserver" in window)) return;
  const cards = document.querySelectorAll(
    ".post-card, .project-card, .resource-card, .story-panel, .taxonomy-card, .timeline-row, .logic-panel"
  );
  const viewBottom = window.innerHeight * 0.92;
  const waiting = [];
  cards.forEach((el) => {
    if (el.getBoundingClientRect().top > viewBottom) {
      el.classList.add("reveal-wait");
      waiting.push(el);
    }
  });
  if (!waiting.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-seen");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -4% 0px", threshold: 0.05 });
  waiting.forEach((el) => observer.observe(el));
})();

/* SeaAnimationController — one click, one complete wave-and-jump cycle.
   States: idle → waking → settling → idle; "reduced" plays an
   opacity-only breath. CSS owns the motion; this owns the state. */
(function () {
  if (window.__sea) return; // sea.js owns the Chrome-first timeline on home
  const scene = document.getElementById("hero-scene");
  const hero = scene && scene.closest(".hero");
  const button = document.getElementById("sea-button");
  if (!scene || !hero || !button) return;

  const reduced = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  const BREATH_MS = 1200;  // reduced-motion opacity breath

  function cssDurationMs() {
    const value = window.getComputedStyle(hero).getPropertyValue("--sea-dur").trim();
    const amount = Number.parseFloat(value);
    if (!Number.isFinite(amount)) return 3600;
    return value.endsWith("ms") ? amount : amount * 1000;
  }

  /* -- loading: if any overlay hasn't arrived yet, hide them all and fade
     the finished scene in as one once every sprite is decoded. Without
     JavaScript no class is ever added, so the static hero always shows. */
  const overlays = Array.prototype.slice.call(
    scene.querySelectorAll(".hero-layer, .hero-fish")
  );
  if (overlays.some((img) => !img.complete)) {
    scene.classList.add("is-priming");
    const settled = overlays.map((img) => {
      if (img.complete) return Promise.resolve();
      if (img.decode) return img.decode().catch(() => {});
      return new Promise((res) => {
        img.addEventListener("load", res, { once: true });
        img.addEventListener("error", res, { once: true });
      });
    });
    // reveal no matter what after 2.5s so a stalled sprite can't hold the sea
    Promise.race([
      Promise.all(settled),
      new Promise((res) => setTimeout(res, 2500)),
    ]).then(() => {
      requestAnimationFrame(() => {
        scene.classList.remove("is-priming");
        scene.classList.add("is-ready");
      });
    });
  }

  const sea = {
    state: "idle", // idle | waking | settling | reduced
    timer: 0,

    play() {
      if (this.state !== "idle") return "busy";
      if (reduced.matches) {
        this.state = "reduced";
        button.setAttribute("aria-busy", "true");
        button.setAttribute("aria-label", "Ocean response in progress");
        hero.classList.add("is-breathing");
        this.timer = window.setTimeout(() => this.settle(), BREATH_MS + 300);
        return "reduced";
      }
      this.state = "waking";
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Ocean animation in progress");
      hero.classList.add("is-waking");
      // animationend closes the cycle; this is only the safety net
      this.timer = window.setTimeout(() => this.settle(), cssDurationMs() + 500);
      return true;
    },

    /* The keyframes start and end on each element's resting transform and
       run with fill:none, so removing the classes at cycle end (or while
       the hero is off-screen / the tab hidden) lands exactly on rest. */
    settle() {
      if (this.state === "idle") return;
      this.state = "settling";
      window.clearTimeout(this.timer);
      this.timer = 0;
      hero.classList.remove("is-waking", "is-breathing");
      button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", "Play ocean animation");
      this.state = "idle";
    },
  };

  hero.addEventListener("animationend", (event) => {
    if (event.target.classList.contains("hero-wave-front") &&
        (event.animationName === "wave-sweep" || event.animationName === "sea-breath")) {
      sea.settle();
    }
  });

  /* Publish the controller before optional observer hooks so the click target
     and terminal command remain usable in constrained browser environments. */
  window.__sea = sea;
  window.__setSea = function (alive) {
    if (alive) return sea.play();
    if (sea.state === "idle") return false;
    sea.settle();
    return "settled";
  };

  button.addEventListener("click", () => {
    sea.play(); // "busy" while playing → repeated clicks are ignored
  });

  // safety: never keep animating unseen
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sea.settle();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) sea.settle();
      });
    }, { threshold: 0 }).observe(hero);
  }
  if (reduced.addEventListener) {
    reduced.addEventListener("change", () => sea.settle());
  }

})();
