// assets/js/charts.js
// Chart.js renderers for publications page (metrics.json-driven)

function destroyIfExists(chartRef) {
    if (chartRef && typeof chartRef.destroy === "function") chartRef.destroy();
    return null;
}

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

function normStr(x) {
    return String(x ?? "").trim();
}

function clampLabel(s, n = 48) {
    s = normStr(s) || "—";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function countBy(items) {
    const m = new Map();
    for (const it of items) {
        const k = normStr(it);
        if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
}

function topN(mapOrPairs, n = 10) {
    const pairs = Array.isArray(mapOrPairs) ? mapOrPairs : [...mapOrPairs.entries()];
    return pairs.sort((a, b) => b[1] - a[1]).slice(0, n);
}

function toInt(x, fallback = 0) {
    const v = Number(x);
    return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function safeLegendPos(type) {
    return (type === "doughnut" || type === "pie") ? "bottom" : "top";
}

/** ---------------- Core charts ---------------- */

export function renderCitationsByYear(canvasEl, citationsByYear) {
    const arr = asArray(citationsByYear);
    const labels = arr.map(d => String(d.year));
    const values = arr.map(d => toInt(d.citations, 0));

    return new Chart(canvasEl, {
        type: "line",
        data: { labels, datasets: [{ label: "Citations", data: values, tension: 0.25 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

export function renderTopPapers(canvasEl, works) {
    const top = [...asArray(works)]
        .sort((a, b) => (toInt(b.citations) - toInt(a.citations)))
        .slice(0, 8)
        .reverse();

    const labels = top.map(w => clampLabel(w.title, 44));
    const values = top.map(w => toInt(w.citations, 0));

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Citations", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

/** ---------------- Portfolio overview ---------------- */

/**
 * Open access split (from metrics.works fields).
 * Expected:
 * - work.oa_status (gold/green/hybrid/bronze/closed/…)
 * - work.is_oa (bool)
 */
export function renderOaSplit(canvasEl, works) {
    const items = asArray(works);

    const statuses = [];
    for (const w of items) {
        const s = normStr(w?.oa_status);
        if (s) statuses.push(s);
        else if (typeof w?.is_oa === "boolean") statuses.push(w.is_oa ? "oa" : "non-oa");
        else statuses.push("unknown");
    }

    const pairs = topN(countBy(statuses), 12);
    const labels = pairs.map(([k]) => k);
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "doughnut",
        data: { labels, datasets: [{ label: "Works", data: values }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: safeLegendPos("doughnut") } }
        }
    });
}

/**
 * Publication types (from metrics.works `type`)
 */
export function renderTypeMix(canvasEl, works) {
    const items = asArray(works);
    const types = items.map(w => normStr(w?.type) || "—");

    const pairs = topN(countBy(types), 12);
    const labels = pairs.map(([k]) => clampLabel(k, 40));
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Works", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

/**
 * Top venues (from metrics.works `venue`)
 */
export function renderTopVenues(canvasEl, works, topK = 10) {
    const items = asArray(works);
    const venues = items.map(w => normStr(w?.venue) || "—");

    const pairs = topN(countBy(venues), topK);
    const labels = pairs.map(([k]) => clampLabel(k, 48));
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Works", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

/**
 * Top coauthors (from metrics.works `coauthors` list of names).
 * This is the correct approach for your current metrics.json (no raw `authorships`).
 */
export function renderTopCoauthors(canvasEl, worksOrPapers, authorOpenAlexId = "", topK = 10) {
    const items = asArray(worksOrPapers);
    const me = normStr(authorOpenAlexId).replace("https://openalex.org/", "");

    const names = [];

    for (const w of items) {
        // 1) Preferred: your metrics.json already has coauthors: ["A", "B", ...]
        for (const nm of asArray(w?.coauthors)) {
            const s = normStr(nm);
            if (s) names.push(s);
        }

        // 2) Fallback: raw OpenAlex shape with authorships[]
        for (const a of asArray(w?.authorships)) {
            const aid = normStr(a?.author?.id).replace("https://openalex.org/", "");
            const nm = normStr(a?.author?.display_name);
            if (!nm) continue;
            if (me && aid && aid === me) continue;
            names.push(nm);
        }
    }

    const pairs = topN(countBy(names), topK);
    const labels = pairs.map(([k]) => clampLabel(k, 40));
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Coauthored works", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}


/** ---------------- Fun / exploratory ---------------- */

/**
 * Top topics (from metrics.works `topics` list of strings)
 */
export function renderTopTopics(canvasEl, works, topK = 12) {
    const items = asArray(works);

    const topics = [];
    for (const w of items) {
        for (const t of asArray(w?.topics)) {
            const s = normStr(t);
            if (s) topics.push(s);
        }
    }

    const pairs = topN(countBy(topics), topK);
    const labels = pairs.map(([k]) => clampLabel(k, 48));
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Mentions", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

/**
 * Top keywords (from metrics.works `keywords` list of strings)
 * Light stoplist to reduce junk.
 */
export function renderTopKeywords(canvasEl, works, topK = 12) {
    const STOP = new Set([
        "computer science", "software", "engineering", "data", "system", "systems",
        "study", "analysis", "method", "methods", "approach", "approaches"
    ]);

    const items = asArray(works);

    const kws = [];
    for (const w of items) {
        for (const k of asArray(w?.keywords)) {
            const s = normStr(k);
            const low = s.toLowerCase();
            if (!s) continue;
            if (STOP.has(low)) continue;
            kws.push(s);
        }
    }

    const pairs = topN(countBy(kws), topK);
    const labels = pairs.map(([k]) => clampLabel(k, 48));
    const values = pairs.map(([, v]) => v);

    return new Chart(canvasEl, {
        type: "bar",
        data: { labels, datasets: [{ label: "Mentions", data: values }] },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

export {
    destroyIfExists
};
