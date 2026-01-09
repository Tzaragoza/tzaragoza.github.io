import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

OPENALEX_BASE = "https://api.openalex.org"
USER_AGENT = "tzaragoza-site-metrics/1.0"


def normalize_author_id(raw: str) -> str:
    raw = (raw or "").strip()
    raw = raw.replace("https://openalex.org/", "").strip()
    raw = raw.upper()
    if not raw:
        raise ValueError("Missing OPENALEX_AUTHOR_ID")
    if raw.startswith("A"):
        return raw
    # accept "a504..." or "504..."
    if raw.startswith("A") is False and raw.startswith("A") is False:
        return "A" + raw.lstrip("A")
    return raw

def normalize_person_name(name: str) -> str:
    """
    Canonicalize person names:
    - Unicode normalize
    - Strip accents
    - Collapse spaces
    - Title case
    """
    if not name:
        return ""

    # Normalize unicode (é → e + ́)
    name = unicodedata.normalize("NFKD", name)

    # Remove accents
    name = "".join(c for c in name if not unicodedata.combining(c))

    # Normalize whitespace
    name = " ".join(name.split())

    # Canonical casing
    return name.title()

def _get(url: str, params: Optional[dict] = None) -> dict:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    params = params or {}
    email = os.getenv("OPENALEX_EMAIL")
    if email:
        params["mailto"] = email

    r = requests.get(url, params=params, headers=headers, timeout=30)

    if not r.ok:
        print("OpenAlex error:", r.status_code)
        print(r.text)


    r.raise_for_status()
    return r.json()


def fetch_all_works_for_author(author_id: str, per_page: int = 200) -> List[dict]:
    """
    Fetch all works for an author, using cursor pagination.
    """
    works: List[dict] = []
    cursor = "*"
    url = f"{OPENALEX_BASE}/works"
    flt = f"authorships.author.id:{author_id}"

    while True:
        data = _get(
            url,
            params={
                "filter": flt,
                "per-page": per_page,
                "cursor": cursor,
                # keep payload small; add more fields if you need them
                "select": ",".join([
                    # identifiers + basics
                    "id",
                    "doi",
                    "ids",
                    "title",
                    "display_name",
                    "publication_year",
                    "publication_date",
                    "type",
                    "type_crossref",

                    # citations / impact
                    "cited_by_count",
                    "counts_by_year",
                    "fwci",
                    "citation_normalized_percentile",
                    "cited_by_percentile_year",

                    # venue / location / OA footprint
                    "primary_location",
                    "locations",
                    "best_oa_location",
                    "open_access",

                    # topical metadata
                    "primary_topic",
                    "topics",
                    "keywords",
                    "concepts",

                    # collaboration metadata
                    "authorships",

                    # money / policy-ish
                    "apc_list",
                    "apc_paid",
                    "funders",
                    "awards",
                    "sustainable_development_goals",

                    # bookkeeping
                    "updated_date",
                ])
            },
        )

        batch = data.get("results", [])
        works.extend(batch)

        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break

        # be polite (OpenAlex is generous but don't spam)
        time.sleep(0.15)

    return works


def pick_best_url(work: dict) -> str:
    """
    Prefer DOI URL if available, else landing page, else OpenAlex URL.
    """
    ids = work.get("ids") or {}
    doi_url = ids.get("doi")  # usually https://doi.org/...
    if isinstance(doi_url, str) and doi_url.startswith("http"):
        return doi_url

    loc = work.get("primary_location") or {}
    landing = loc.get("landing_page_url")
    if isinstance(landing, str) and landing.startswith("http"):
        return landing

    # fallback to OpenAlex work url
    wid = work.get("id")
    if isinstance(wid, str) and wid.startswith("http"):
        return wid
    if isinstance(wid, str):
        return "https://openalex.org/" + wid.replace("https://openalex.org/", "")
    return "#"


def extract_venue(work: dict) -> str:
    # OpenAlex: host_venue is deprecated/removed; use primary_location/source
    pl = work.get("primary_location") or {}
    src = pl.get("source") or {}
    name = src.get("display_name")
    if isinstance(name, str) and name.strip():
        return name.strip()

    # fallback: sometimes best_oa_location has a source
    bol = work.get("best_oa_location") or {}
    src2 = bol.get("source") or {}
    name2 = src2.get("display_name")
    if isinstance(name2, str) and name2.strip():
        return name2.strip()

    return "—"



_HAL_RE = re.compile(r"\bhal\.science\b|\bhal\.\w+\b", re.IGNORECASE)


def try_find_hal_url(work: dict) -> Optional[str]:
    """
    Best-effort: scan likely URL fields for HAL links.
    """
    candidates: List[str] = []

    ids = work.get("ids") or {}
    for k in ("openalex", "doi", "pmid", "pmcid", "mag"):
        v = ids.get(k)
        if isinstance(v, str):
            candidates.append(v)

    loc = work.get("primary_location") or {}
    for k in ("landing_page_url", "pdf_url"):
        v = loc.get(k)
        if isinstance(v, str):
            candidates.append(v)

    # Some HAL links appear in other locations; scan host_venue url too
    hv = work.get("host_venue") or {}
    v = hv.get("url")
    if isinstance(v, str):
        candidates.append(v)

    for u in candidates:
        if u and _HAL_RE.search(u):
            return u

    return None

def _safe_float(x) -> float | None:
    try:
        return float(x)
    except Exception:
        return None

def _safe_int(x) -> int | None:
    try:
        return int(x)
    except Exception:
        return None

def extract_oa_status(work: dict) -> str:
    oa = work.get("open_access") or {}
    # typical values: gold, green, hybrid, bronze, closed
    s = oa.get("oa_status")
    if isinstance(s, str) and s.strip():
        return s.strip().lower()
    return "unknown"

def extract_is_oa(work: dict) -> bool:
    oa = work.get("open_access") or {}
    v = oa.get("is_oa")
    return bool(v) if isinstance(v, bool) else False

def extract_topics(work: dict, top_k: int = 3) -> list[str]:
    # topics is a list of objects with display_name / score
    topics = work.get("topics") or []
    out = []
    if isinstance(topics, list):
        for t in sorted(topics, key=lambda x: x.get("score", 0), reverse=True)[:top_k]:
            name = (t or {}).get("display_name")
            if isinstance(name, str) and name.strip():
                out.append(name.strip())
    return out

def extract_keywords(work: dict, top_k: int = 10) -> list[str]:
    kws = work.get("keywords") or []
    out = []
    if isinstance(kws, list):
        for k in sorted(kws, key=lambda x: x.get("score", 0), reverse=True)[:top_k]:
            name = (k or {}).get("display_name")
            if isinstance(name, str) and name.strip():
                out.append(name.strip())
    return out

def extract_coauthors(work: dict, self_author_id: str) -> list[str]:
    auths = work.get("authorships") or []
    names: list[str] = []

    if not isinstance(auths, list):
        return names

    for a in auths:
        au = (a or {}).get("author") or {}
        aid = au.get("id")
        raw_name = au.get("display_name")

        if isinstance(aid, str) and aid.replace("https://openalex.org/", "") == self_author_id:
            continue

        if isinstance(raw_name, str) and raw_name.strip():
            names.append(normalize_person_name(raw_name))

    return names


def normalize_work(work: dict, self_author_id: str) -> Dict[str, Any]:
    title = (work.get("title") or "").strip() or "Untitled"
    year = _safe_int(work.get("publication_year"))
    cites = _safe_int(work.get("cited_by_count")) or 0

    ids = work.get("ids") or {}
    doi = work.get("doi") or ids.get("doi")
    if isinstance(doi, str):
        doi = doi.strip().replace("https://doi.org/", "")
    else:
        doi = None

    openalex_id = work.get("id")
    if isinstance(openalex_id, str):
        openalex_id = openalex_id.replace("https://openalex.org/", "")
    else:
        openalex_id = None

    return {
        "id": openalex_id,
        "title": title,
        "year": year,
        "venue": extract_venue(work),
        "citations": cites,
        "doi": doi,
        "url": pick_best_url(work),
        "hal_url": try_find_hal_url(work),
        "type": (work.get("type") or work.get("type_crossref") or "").strip() or "—",

        # rich fields you requested (now actually kept)
        "is_oa": extract_is_oa(work),
        "oa_status": extract_oa_status(work),
        "fwci": _safe_float(work.get("fwci")),
        "citation_norm_percentile": (work.get("citation_normalized_percentile") or {}).get("value"),
        "topics": extract_topics(work, top_k=3),
        "keywords": extract_keywords(work, top_k=10),
        "coauthors": extract_coauthors(work, self_author_id),

        "source": "OpenAlex",
    }


def build_citations_by_year(papers: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    by_year: Dict[int, int] = {}
    for p in papers:
        y = p.get("year")
        c = p.get("citations") or 0
        if isinstance(y, int):
            by_year[y] = by_year.get(y, 0) + int(c)

    return [{"year": y, "citations": by_year[y]} for y in sorted(by_year.keys())]

def _norm_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    d = doi.strip().lower()
    d = d.replace("https://doi.org/", "").replace("http://doi.org/", "")
    d = d.replace("doi:", "")
    return d or None

def _get_doi(work: Dict[str, Any]) -> str | None:
    # OpenAlex often has `doi` at top-level as URL
    doi = work.get("doi")
    if isinstance(doi, str):
        return _norm_doi(doi)
    # sometimes in ids
    ids = work.get("ids") or {}
    if isinstance(ids, dict) and isinstance(ids.get("doi"), str):
        return _norm_doi(ids["doi"])
    return None

def _get_hal_id(work: Dict[str, Any]) -> str | None:
    ids = work.get("ids") or {}
    if isinstance(ids, dict):
        # Sometimes OpenAlex stores HAL as pmh id in ids.openalex? No. But often in `locations[*].id`
        pass

    # Check locations for HAL pmh id
    for loc in (work.get("locations") or []):
        loc_id = loc.get("id")
        if isinstance(loc_id, str) and loc_id.startswith("pmh:oai:HAL:"):
            return loc_id

    # Also check primary_location
    pl = work.get("primary_location") or {}
    pl_id = pl.get("id")
    if isinstance(pl_id, str) and pl_id.startswith("pmh:oai:HAL:"):
        return pl_id

    return None

def _norm_title(title: str | None) -> str:
    if not title:
        return ""
    t = title.lower().strip()
    # remove leading chapter numbers like "17 " or "17."
    t = re.sub(r"^\s*\d+\s*[\.\-:\)]\s*", "", t)
    # normalize punctuation/whitespace
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s]", "", t)
    return t.strip()

def _first_author(work: Dict[str, Any]) -> str:
    auths = work.get("authorships") or []
    if not auths:
        return ""
    a0 = auths[0].get("author") or {}
    name = a0.get("display_name") or ""
    return str(name).strip().lower()

def dedupe_works(works: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}

    for w in works:
        doi = _get_doi(w)
        if doi:
            key = ("doi", doi)
        else:
            hal = _get_hal_id(w)
            if hal:
                key = ("hal", hal)
            else:
                # last resort: normalized title + year + first author
                key = ("fuzzy", f"{_norm_title(w.get('title') or w.get('display_name'))}|{w.get('publication_year')}|{_first_author(w)}")

        buckets.setdefault(key, []).append(w)

    def score(work: Dict[str, Any]) -> Tuple[int, int, int]:
        # Higher is better
        has_doi = 1 if _get_doi(work) else 0
        cites = int(work.get("cited_by_count") or 0)

        # Prefer publisher/journal/book source over repository if possible
        # Heuristic: best_oa_location / primary_location has a 'source' with type not 'repository'
        loc = work.get("best_oa_location") or work.get("primary_location") or {}
        src = (loc.get("source") or {}) if isinstance(loc, dict) else {}
        src_type = str(src.get("type") or "").lower()
        is_repo = 1 if src_type == "repository" else 0
        publisher_bonus = 1 - is_repo  # 1 if not repo, 0 if repo

        return (has_doi, cites, publisher_bonus)

    deduped: List[Dict[str, Any]] = []
    for _, group in buckets.items():
        if len(group) == 1:
            deduped.append(group[0])
        else:
            group_sorted = sorted(group, key=score, reverse=True)
            winner = group_sorted[0]

            # OPTIONAL: if you want, you can merge citations/ids from losers here.
            deduped.append(winner)

    return deduped

def main() -> None:
    # Put your author id in env, so the repo isn't hardcoded to one person
    raw_author_id = os.getenv("OPENALEX_AUTHOR_ID", "A5042578790")
    author_id = normalize_author_id(raw_author_id)

    works = fetch_all_works_for_author(author_id=author_id)
    works = dedupe_works(works)

    papers = [normalize_work(w, self_author_id=author_id) for w in works]

    # Sort: newest first, then citations desc
    papers.sort(key=lambda p: ((p.get("year") or 0), (p.get("citations") or 0)), reverse=True)

    total_citations = sum(int(p.get("citations") or 0) for p in papers)
    citations_by_year = build_citations_by_year(papers)

    out = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "author_openalex_id": author_id,

        # counters / aggregates
        "papers_tracked": len(papers),
        "total_citations": total_citations,
        "citations_by_year": citations_by_year,

        # main payload
        "works": papers,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/metrics.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(
        f"[OK] Fetched {out['papers_tracked']} works for {author_id}, "
        f"total citations={out['total_citations']}"
    )



if __name__ == "__main__":
    main()
