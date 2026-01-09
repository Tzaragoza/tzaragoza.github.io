// assets/js/app.js
import { loadJson } from "./utils.js";
import { renderStats, renderPubsTable } from "./render.js";
import {
    destroyIfExists,
    renderCitationsByYear,
    renderTopPapers,
    renderOaSplit,
    renderTypeMix,
    renderTopVenues,
    renderTopCoauthors,
    renderTopTopics,
    renderTopKeywords
} from "./charts.js";

let charts = {
    citationsByYear: null,
    topPapers: null,
    oaSplit: null,
    typeMix: null,
    venues: null,
    coauthors: null,
    topics: null,
    keywords: null
};

function el(id) {
    return document.getElementById(id);
}

function toInt(x, fallback = 0) {
    const v = Number(x);
    return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/**
 * Build citations-by-year aggregate from metrics.works
 * Output: [{year: 2024, citations: 3}, ...] sorted by year asc
 */
function buildCitationsByYear(works) {
    const byYear = new Map();
    for (const w of works) {
        const y = toInt(w?.year, NaN);
        if (!Number.isFinite(y)) continue;
        const c = toInt(w?.citations, 0);
        byYear.set(y, (byYear.get(y) ?? 0) + c);
    }
    return [...byYear.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([year, citations]) => ({ year, citations }));
}

async function main() {
    const metrics = await loadJson("data/metrics.json");

    // Your file uses `works`, not `papers`
    const works = Array.isArray(metrics?.works) ? metrics.works : [];

    // ---- Make a stats object that matches whatever renderStats expects ----
    // (This avoids "—" / 0 when renderStats is still on old keys.)
    const statsModel = {
        ...metrics,
        // common names
        total_citations: metrics?.total_citations ?? metrics?.totalCitations ?? toInt(
            works.reduce((acc, w) => acc + toInt(w?.citations, 0), 0),
            0
        ),
        papers_tracked: metrics?.papers_tracked ?? metrics?.papersTracked ?? works.length,
        updated_at: metrics?.updated_at ?? metrics?.updatedAt ?? null
    };

    // Stats
    const hasStats = el("statTotalCites") || el("statPaperCount") || el("statUpdatedAt");
    if (hasStats) renderStats(statsModel);

    // Publications table
    const tableWrap = el("pubsTableWrap");
    const sortSelect = el("sortSelect");
    if (tableWrap && sortSelect) {
        const rerender = () => {
            const sortValue = sortSelect.value || "citations_desc";
            renderPubsTable(tableWrap, works, sortValue);
        };
        sortSelect.addEventListener("change", rerender);
        rerender();
    }

    // Precompute citations by year (fallback if file doesn’t contain it)
    const citationsByYear = Array.isArray(metrics?.citations_by_year)
        ? metrics.citations_by_year
        : buildCitationsByYear(works);

    // ---- Core charts ----
    const c1 = el("chartCitationsByYear");
    if (c1) {
        charts.citationsByYear = destroyIfExists(charts.citationsByYear);
        charts.citationsByYear = renderCitationsByYear(c1, citationsByYear);
    }

    const c2 = el("chartTopPapers");
    if (c2) {
        charts.topPapers = destroyIfExists(charts.topPapers);
        charts.topPapers = renderTopPapers(c2, works);
    }

    // ---- Portfolio overview ----
    const cOa = el("chartOaSplit");
    if (cOa) {
        charts.oaSplit = destroyIfExists(charts.oaSplit);
        charts.oaSplit = renderOaSplit(cOa, works);
    }

    const cType = el("chartTypeMix");
    if (cType) {
        charts.typeMix = destroyIfExists(charts.typeMix);
        charts.typeMix = renderTypeMix(cType, works);
    }

    const cVen = el("chartVenues");
    if (cVen) {
        charts.venues = destroyIfExists(charts.venues);
        charts.venues = renderTopVenues(cVen, works, 10);
    }

    const cCo = el("chartCoauthors");
    if (cCo) {
        charts.coauthors = destroyIfExists(charts.coauthors);

        // FIX: your charts.js renderTopCoauthors expects your OpenAlex author id so it can exclude "you".
        const authorId = String(metrics?.author_openalex_id ?? "").replace("https://openalex.org/", "");
        charts.coauthors = renderTopCoauthors(cCo, works, authorId, 10);
    }

    // ---- Fun / exploratory ----
    const cTopics = el("chartTopics");
    if (cTopics) {
        charts.topics = destroyIfExists(charts.topics);
        charts.topics = renderTopTopics(cTopics, works, 12);
    }

    const cKw = el("chartKeywords");
    if (cKw) {
        charts.keywords = destroyIfExists(charts.keywords);
        charts.keywords = renderTopKeywords(cKw, works, 12);
    }
}

main().catch((err) => {
    console.error(err);
    const tableWrap = el("pubsTableWrap");
    if (tableWrap) {
        tableWrap.innerHTML =
            `<p class="muted">Failed to load metrics. Check <code>data/metrics.json</code> and console.</p>`;
    }
});
