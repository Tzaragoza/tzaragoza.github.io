import { escapeHtml, formatInt } from "./utils.js";

// assets/js/render.js

function el(id) {
    return document.getElementById(id);
}

function toInt(x, fallback = 0) {
    const v = Number(x);
    return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export function renderStats(metrics) {
    console.log("[renderStats] keys:", Object.keys(metrics || {}));
    console.log("[renderStats] works length:", metrics?.works?.length);
    console.log("[renderStats] papers length:", metrics?.papers?.length);
    console.log("[renderStats] papers_tracked:", metrics?.papers_tracked);

    const works = Array.isArray(metrics?.works)
        ? metrics.works
        : Array.isArray(metrics?.papers)
            ? metrics.papers
            : [];

    const totalCitations =
        metrics?.total_citations ??
        metrics?.totalCitations ??
        toInt(works.reduce((acc, w) => acc + toInt(w?.citations, 0), 0), 0);

    const papersTracked =
        metrics?.papers_tracked ??
        metrics?.papersTracked ??
        works.length;

    const updatedAt =
        metrics?.updated_at ??
        metrics?.updatedAt ??
        null;

    const sCites = el("statTotalCites");
    const sCount = el("statPaperCount");
    const sUpd = el("statUpdatedAt");

    if (sCites) sCites.textContent = String(toInt(totalCitations, 0));
    if (sCount) sCount.textContent = String(toInt(papersTracked, works.length));
    if (sUpd) sUpd.textContent = fmtDate(updatedAt);
}

export function renderPubsTable(containerEl, pubs, sortMode) {
  const papers = [...pubs];

  const sorters = {
    citations_desc: (a,b) => (b.citations ?? 0) - (a.citations ?? 0),
    year_desc:      (a,b) => (b.year ?? 0) - (a.year ?? 0),
    year_asc:       (a,b) => (a.year ?? 0) - (b.year ?? 0),
    title_asc:      (a,b) => String(a.title).localeCompare(String(b.title))
  };
  papers.sort(sorters[sortMode] ?? sorters.citations_desc);

  const rows = papers.map(p => {
    const title = escapeHtml(p.title ?? "Untitled");
    const url = escapeHtml(p.url ?? "#");
    const year = escapeHtml(String(p.year ?? "—"));
    const cites = formatInt(p.citations);
    const source = escapeHtml(p.source ?? "—");
    const doi = p.doi ? `<span class="badge">DOI</span>` : "";
    const arxiv = p.arxiv ? `<span class="badge">arXiv</span>` : "";

    return `
      <tr>
        <td>
          <a class="paper" href="${url}" target="_blank" rel="noreferrer"><b>${title}</b></a>
          <div class="muted small" style="margin-top:4px">
            ${doi} ${arxiv}
          </div>
        </td>
        <td>${year}</td>
        <td>${cites}</td>
        <td class="muted small">${source}</td>
      </tr>
    `;
  }).join("");

  containerEl.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Paper</th>
          <th>Year</th>
          <th>Citations</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
