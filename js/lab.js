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