// assets/js/news.js
// Renders Latest news from data/news.json with safe rich text (allowlisted HTML)

async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
}

function esc(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmtMonthYear(isoDate) {
    // Accepts "YYYY-MM-DD" (recommended). Fallback to raw string.
    const d = String(isoDate || "").trim();
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return d || "—";
    const [, yyyy, mm] = m;
    return `${mm}/${yyyy}`; // e.g., 12/2025
}

/**
 * Allowlist sanitizer for small formatting needs.
 * Allowed tags: A, STRONG, EM, B, I, CODE, BR, SPAN
 * Allowed attributes:
 *  - A: href (only http/https), target, rel
 *  - SPAN: class (optional, if you want badges later)
 *
 * Everything else is stripped (keeps child text content).
 */
function sanitizeNewsHTML(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html ?? "");

    const allowedTags = new Set(["A", "STRONG", "EM", "B", "I", "CODE", "BR", "SPAN"]);

    // Walk over all element nodes
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
    const toProcess = [];
    while (walker.nextNode()) toProcess.push(walker.currentNode);

    for (const el of toProcess) {
        const tag = el.tagName;

        if (!allowedTags.has(tag)) {
            // Replace disallowed element with its children (keeps text)
            el.replaceWith(...el.childNodes);
            continue;
        }

        // Strip attributes (keep only a safe subset)
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();

            if (tag === "A" && (name === "href" || name === "target" || name === "rel")) continue;
            if (tag === "SPAN" && name === "class") continue;

            el.removeAttribute(attr.name);
        }

        if (tag === "A") {
            const href = el.getAttribute("href") || "";
            const ok = href.startsWith("http://") || href.startsWith("https://");
            if (!ok) el.removeAttribute("href");

            // Force safe link behavior
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noreferrer");
        }
    }

    return tpl.innerHTML;
}

function renderNews(items) {
    const wrap = document.getElementById("newsWrap");
    if (!wrap) return;

    if (!Array.isArray(items) || items.length === 0) {
        wrap.innerHTML = `<p class="muted">No news yet. Add items to <code>data/news.json</code>.</p>`;
        return;
    }

    const LIMIT = 5;
    const canToggle = items.length > LIMIT;

    // Build the static shell
    wrap.innerHTML = `
    ${canToggle ? `
      <div class="news-controls">
        <button id="newsToggleBtn" class="btn" type="button" aria-expanded="false">
          Show all (${items.length})
        </button>
      </div>
    ` : ``}
    <div id="newsListInner"></div>
  `;

    const listInner = document.getElementById("newsListInner");
    const btn = document.getElementById("newsToggleBtn");

    const renderList = (sliceCount) => {
        const subset = sliceCount ? items.slice(0, sliceCount) : items;

        const html = subset.map((it) => {
            const when = fmtMonthYear(it.date);
            const badges = Array.isArray(it.tags)
                ? it.tags.map(t => `<span class="badge">${esc(t)}</span>`).join(" ")
                : it.tag ? `<span class="badge">${esc(it.tag)}</span>` : "";
            const title = it.title ? `<div class="news-title">${esc(it.title)}</div>` : "";
            const body = it.body_html ? sanitizeNewsHTML(it.body_html) : "";
            const icon = it.icon
                ? `<img class="news-icon" src="${esc(it.icon)}" alt="" loading="lazy" />`
                : "";

            return `
        <article class="news-item">
          <div class="news-meta">
          <span class="muted small">${esc(when)}</span>
          ${badges}
        </div>


          <div class="news-main">
            ${icon}
            <div class="news-text">
              ${title}
              ${body ? `<div class="news-body">${body}</div>` : ""}
            </div>
          </div>
        </article>
      `;
        }).join("");

        listInner.innerHTML = html;
    };

    // Initial: show latest 5
    renderList(LIMIT);

    if (btn) {
        btn.addEventListener("click", () => {
            const expanded = btn.getAttribute("aria-expanded") === "true";
            const nextExpanded = !expanded;

            btn.setAttribute("aria-expanded", String(nextExpanded));
            if (nextExpanded) {
                renderList(null); // all
                btn.textContent = "Show less";
            } else {
                renderList(LIMIT);
                btn.textContent = `Show all (${items.length})`;
            }
        });
    }
}

async function main() {
    const wrap = document.getElementById("newsWrap");
    try {
        const data = await loadJSON("data/news.json");
        const items = Array.isArray(data.items) ? data.items : [];

        // Sort newest first by date string "YYYY-MM-DD"
        items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

        renderNews(items);
    } catch (e) {
        if (wrap) {
            wrap.innerHTML = `<p class="muted">Failed to load news. Check <code>data/news.json</code> and your server path.</p>`;
        }
        console.error(e);
    }
}

main();
