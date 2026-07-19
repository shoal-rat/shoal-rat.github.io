(function () {
  const panel = document.querySelector("[data-search-panel]");
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
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

/* The hero console becomes a small, quiet shell */
(function () {
  const host = document.querySelector(".hero-console");
  if (!host) return;

  const ROUTES = {
    home: "/", projects: "/projects/", archive: "/archives/", archives: "/archives/",
    tags: "/tags/", categories: "/categories/", resources: "/resources/",
    about: "/aboutme/", aboutme: "/aboutme/", lively: "/lively/",
  };
  const KOANS = [
    "潮起潮落，代码常新。",
    "the wave returns to the sea.",
    "格物致知，即物穷理。",
    "no signal is also a signal.",
    "empty stack, quiet mind.",
  ];

  const out = document.createElement("div");
  out.className = "console-out";
  out.setAttribute("aria-live", "polite");

  const row = document.createElement("div");
  row.className = "console-input-row";
  const prompt = document.createElement("span");
  prompt.className = "prompt";
  prompt.textContent = "$";
  const field = document.createElement("input");
  field.className = "console-field";
  field.type = "text";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.placeholder = 'type "help"';
  field.setAttribute("aria-label", 'Lab terminal. Type "help" for commands.');
  row.append(prompt, field);

  host.append(out, row);
  host.classList.add("is-live");
  host.addEventListener("click", () => field.focus());

  let lastCommand = "";

  function print(text, cls) {
    const line = document.createElement("div");
    line.className = "console-line" + (cls ? " " + cls : "");
    line.textContent = text;
    out.append(line);
    while (out.children.length > 6) out.removeChild(out.firstChild);
  }

  function exec(raw) {
    const parts = raw.trim().split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();
    const arg = (parts[1] || "").toLowerCase();
    if (!cmd) return;
    print("$ " + raw.trim(), "is-cmd");
    switch (cmd) {
      case "help":
        print("commands: ls · open <place> · whoami · zen · clear", "is-quiet");
        print("places: " + Object.keys(ROUTES).filter(k => k !== "archives" && k !== "about").join(" · ") + " · github", "is-quiet");
        break;
      case "ls":
        print("projects/  archives/  tags/  categories/  resources/  aboutme/  lively/");
        break;
      case "open":
      case "cd":
        if (!arg) { print("usage: open <place> — try `open projects`", "is-quiet"); break; }
        if (arg === "github") { window.open("https://github.com/shoal-rat", "_blank", "noopener"); break; }
        if (ROUTES[arg]) { print("→ " + ROUTES[arg], "is-quiet"); window.location.href = ROUTES[arg]; break; }
        print("no such place: " + arg, "is-quiet");
        break;
      case "whoami":
        print("shoral rat — econ × cs × ai, learning in public.");
        break;
      case "zen":
        print(KOANS[Math.floor(Math.random() * KOANS.length)]);
        break;
      case "clear":
        out.innerHTML = "";
        break;
      case "sudo":
        print("the sea does not take orders.", "is-quiet");
        break;
      default:
        print("command not found: " + cmd + " — try `help`", "is-quiet");
    }
  }

  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const value = field.value;
      if (value.trim()) lastCommand = value;
      exec(value);
      field.value = "";
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      field.value = lastCommand;
    }
  });
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
