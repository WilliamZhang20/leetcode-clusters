#!/usr/bin/env python3
"""Scrape every LeetCode problem and compute a similarity layout.

The site loads ``data/problems.json``. Re-run this script to refresh the
snapshot from LeetCode's public problemset GraphQL API, then rebuild
similarity links and map positions.

Offline recompute (no network), after hand-editing tags or
``data/extra-problems.json``::

    python3 scripts/scrape_and_compute.py --offline

Similarity
----------
Jaccard overlap of topic-tag sets. When two problems share at least one
tag and the same difficulty band, add ``DIFFICULTY_BOOST`` and cap at 1.

Placement
---------
Tags sit on a ring, ordered so tags that share problems are neighbors.
Each problem sits at the inverse-frequency-weighted center of its tags,
so a rare technique pulls harder than a broad tag such as Array. A short
collision pass separates bubbles without abandoning that anchor. When
more than eight problems tie on score, the stored neighbors prefer
shared title words and then nearer problem numbers. The score itself
does not use the title.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "problems.json"
EXTRAS_PATH = ROOT / "data" / "extra-problems.json"

GRAPHQL_URL = "https://leetcode.com/graphql"
PAGE_SIZE = 100
NEIGHBORS = 8
MIN_NEIGHBOR_SCORE = 0.20
DIFFICULTY_BOOST = 0.05
DIFFICULTIES = ("Easy", "Medium", "Hard")
TITLE_STOP = {
    "a", "an", "the", "of", "to", "in", "for", "and", "or", "with", "from",
    "on", "by", "at", "into", "your", "you", "is", "it", "its", "be", "as",
    "via", "per", "all", "any", "no", "not", "after", "before", "than",
    "ii", "iii", "iv", "vi", "vii", "viii", "ix",
}

QUERY = """
query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  problemsetQuestionList: questionList(
    categorySlug: $categorySlug
    limit: $limit
    skip: $skip
    filters: $filters
  ) {
    total: totalNum
    questions: data {
      difficulty
      frontendQuestionId: questionFrontendId
      paidOnly: isPaidOnly
      title
      titleSlug
      topicTags { name slug }
    }
  }
}
"""


def log(message: str) -> None:
    print(message, file=sys.stderr)


def graphql(skip: int, limit: int) -> dict:
    payload = {
        "query": QUERY,
        "variables": {
            "categorySlug": "",
            "skip": skip,
            "limit": limit,
            "filters": {},
        },
    }
    body = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Origin": "https://leetcode.com",
        "Referer": "https://leetcode.com/problemset/",
    }
    last_error: Exception | None = None
    for attempt in range(4):
        request = urllib.request.Request(GRAPHQL_URL, data=body, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                parsed = json.loads(response.read().decode())
            if parsed.get("errors"):
                raise RuntimeError(json.dumps(parsed["errors"])[:500])
            return parsed["data"]["problemsetQuestionList"]
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"LeetCode request failed at skip={skip}: {last_error}")


def scrape_problems() -> tuple[list[dict], dict[str, str]]:
    first = graphql(0, PAGE_SIZE)
    total = int(first["total"])
    log(f"LeetCode reports {total} problems")
    raw_pages = [first]
    skip = PAGE_SIZE
    while skip < total:
        log(f"fetching {skip}–{min(skip + PAGE_SIZE, total)} of {total}")
        raw_pages.append(graphql(skip, PAGE_SIZE))
        skip += PAGE_SIZE
        time.sleep(0.12)

    problems: list[dict] = []
    names: dict[str, str] = {}
    seen: set[str] = set()
    for page in raw_pages:
        fresh = 0
        for question in page.get("questions") or []:
            problem = normalize_question(question, names)
            if problem["id"] in seen:
                continue
            seen.add(problem["id"])
            problems.append(problem)
            fresh += 1
        if fresh == 0:
            raise RuntimeError("Pagination returned no new problems; aborting so the dataset is not truncated.")
    if len(problems) < total * 0.98:
        raise RuntimeError(f"Expected about {total} problems, got {len(problems)}")
    log(f"scraped {len(problems)} unique problems")
    return problems, names


def normalize_question(question: dict, names: dict[str, str]) -> dict:
    frontend_id = str(question.get("frontendQuestionId") or "").strip()
    slug = str(question.get("titleSlug") or "").strip()
    if not frontend_id:
        frontend_id = slug
    tags: list[str] = []
    for tag in question.get("topicTags") or []:
        tag_slug = str(tag.get("slug") or "").strip()
        tag_name = str(tag.get("name") or "").strip() or display_name(tag_slug)
        if not tag_slug or tag_slug in tags:
            continue
        tags.append(tag_slug)
        names.setdefault(tag_slug, tag_name)
    difficulty = str(question.get("difficulty") or "Medium")
    if difficulty not in DIFFICULTIES:
        difficulty = "Medium"
    return {
        "id": frontend_id,
        "title": str(question.get("title") or slug or frontend_id),
        "slug": slug,
        "difficulty": difficulty,
        "tags": tags,
        "url": f"https://leetcode.com/problems/{slug}/" if slug else "",
        "paid": bool(question.get("paidOnly")),
    }


def display_name(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.split("-")) or slug


def load_existing() -> tuple[list[dict], dict[str, str]]:
    if not DATA_PATH.exists():
        raise SystemExit(f"No dataset at {DATA_PATH}. Run without --offline first.")
    payload = json.loads(DATA_PATH.read_text())
    names = {tag["slug"]: tag["name"] for tag in payload.get("tags", []) if "slug" in tag}
    problems = []
    for problem in payload.get("problems", []):
        item = {key: problem[key] for key in ("id", "title", "slug", "difficulty", "tags", "url", "paid")}
        item["id"] = str(item["id"])
        item["tags"] = [str(tag) for tag in item.get("tags") or []]
        problems.append(item)
        for tag in item["tags"]:
            names.setdefault(tag, display_name(tag))
    return problems, names


def load_extras() -> list[dict]:
    if not EXTRAS_PATH.exists():
        return []
    payload = json.loads(EXTRAS_PATH.read_text())
    if not isinstance(payload, list):
        raise SystemExit("data/extra-problems.json must be a JSON array of problems")
    extras = []
    for raw in payload:
        slug = str(raw.get("slug") or "").strip()
        difficulty = str(raw.get("difficulty") or "Medium")
        if difficulty not in DIFFICULTIES:
            raise SystemExit(f"Unknown difficulty on extra problem {raw.get('id')!r}")
        tags = []
        for tag in raw.get("tags") or []:
            if isinstance(tag, dict):
                tag_slug = str(tag.get("slug") or "").strip()
            else:
                tag_slug = str(tag).strip()
            if tag_slug and tag_slug not in tags:
                tags.append(tag_slug)
        problem_id = str(raw.get("id") or "").strip()
        if not problem_id:
            raise SystemExit("Every extra problem needs an id")
        extras.append(
            {
                "id": problem_id,
                "title": str(raw.get("title") or slug or problem_id),
                "slug": slug,
                "difficulty": difficulty,
                "tags": tags,
                "url": str(raw.get("url") or (f"https://leetcode.com/problems/{slug}/" if slug else "")),
                "paid": bool(raw.get("paid")),
            }
        )
    log(f"merging {len(extras)} extra problem record(s)")
    return extras


def merge_extras(problems: list[dict], names: dict[str, str], extras: list[dict]) -> list[dict]:
    by_id = {problem["id"]: problem for problem in problems}
    for extra in extras:
        current = by_id.get(extra["id"], {})
        merged = {
            "id": extra["id"],
            "title": extra["title"] or current.get("title", extra["id"]),
            "slug": extra["slug"] or current.get("slug", ""),
            "difficulty": extra["difficulty"],
            "tags": extra["tags"] if extra["tags"] else list(current.get("tags") or []),
            "url": extra["url"] or current.get("url", ""),
            "paid": extra["paid"] if "paid" in extra else bool(current.get("paid")),
        }
        by_id[extra["id"]] = merged
        for tag in merged["tags"]:
            names.setdefault(tag, display_name(tag))
    return list(by_id.values())


def sort_key(problem: dict) -> tuple:
    problem_id = problem["id"]
    if problem_id.isdigit():
        return (0, int(problem_id), problem_id)
    return (1, problem_id)


def fnv(text: str) -> int:
    value = 2166136261
    for char in text:
        value ^= ord(char)
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def hsl_hex(hue: float, saturation: float, lightness: float) -> str:
    hue = hue % 360
    chroma = (1 - abs(2 * lightness - 1)) * saturation
    hp = hue / 60
    x = chroma * (1 - abs(hp % 2 - 1))
    if hp < 1:
        red, green, blue = chroma, x, 0
    elif hp < 2:
        red, green, blue = x, chroma, 0
    elif hp < 3:
        red, green, blue = 0, chroma, x
    elif hp < 4:
        red, green, blue = 0, x, chroma
    elif hp < 5:
        red, green, blue = x, 0, chroma
    else:
        red, green, blue = chroma, 0, x
    match = lightness - chroma / 2
    red, green, blue = red + match, green + match, blue + match

    def channel(component: float) -> int:
        return max(0, min(255, round(component * 255)))

    return f"#{channel(red):02x}{channel(green):02x}{channel(blue):02x}"


def tag_color(slug: str) -> str:
    hue = fnv(slug) % 360
    return hsl_hex(hue, 0.58, 0.66)


def title_tokens(title: str) -> frozenset[str]:
    tokens: list[str] = []
    for token in re.findall(r"[a-z0-9]+", title.lower()):
        if token in TITLE_STOP or len(token) <= 1:
            continue
        if len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
            token = token[:-1]
        tokens.append(token)
    return frozenset(tokens)


def _push_neighbor(heap: list[tuple[float, float, float, str]], item: tuple[float, float, float, str]) -> None:
    if item[0] < MIN_NEIGHBOR_SCORE:
        return
    if len(heap) < NEIGHBORS:
        heapq.heappush(heap, item)
    elif item > heap[0]:
        heapq.heapreplace(heap, item)


def compute_similarity(problems: list[dict]) -> None:
    """Keep each problem's strongest Jaccard neighbors.

    Tag sets are bitmasks so each pair is a couple of integer operations.
    Ties are broken by shared title words, then nearer problem numbers,
    so House Robber is stored next to House Robber II when their tags match.
    """
    masks: list[int] = []
    tag_index: dict[str, int] = {}
    tokens = [title_tokens(problem["title"]) for problem in problems]
    numbers = [int(problem["id"]) if problem["id"].isdigit() else None for problem in problems]
    for problem in problems:
        mask = 0
        for tag in problem["tags"]:
            bit = tag_index.setdefault(tag, len(tag_index))
            mask |= 1 << bit
        masks.append(mask)

    def title_overlap(left: int, right: int) -> float:
        a, b = tokens[left], tokens[right]
        if not a or not b:
            return 0.0
        inter = len(a & b)
        if inter == 0:
            return 0.0
        return inter / (len(a) + len(b) - inter)

    def proximity(left: int, right: int) -> float:
        if numbers[left] is None or numbers[right] is None:
            return 0.0
        return 1.0 / (1.0 + abs(numbers[left] - numbers[right]))

    heaps: list[list[tuple[float, float, float, str]]] = [[] for _ in problems]
    total = len(problems)
    for i in range(total):
        left = masks[i]
        if left == 0:
            continue
        left_bits = left.bit_count()
        left_diff = problems[i]["difficulty"]
        for j in range(i + 1, total):
            right = masks[j]
            if right == 0:
                continue
            inter = (left & right).bit_count()
            if inter == 0:
                continue
            union = left_bits + right.bit_count() - inter
            score = inter / union
            if score <= 0:
                continue
            if left_diff == problems[j]["difficulty"]:
                score = min(1.0, score + DIFFICULTY_BOOST)
            if score < MIN_NEIGHBOR_SCORE:
                continue
            need_i = len(heaps[i]) < NEIGHBORS or score >= heaps[i][0][0]
            need_j = len(heaps[j]) < NEIGHBORS or score >= heaps[j][0][0]
            if not need_i and not need_j:
                continue
            overlap = title_overlap(i, j)
            near = proximity(i, j)
            if need_i:
                _push_neighbor(heaps[i], (score, overlap, near, problems[j]["id"]))
            if need_j:
                _push_neighbor(heaps[j], (score, overlap, near, problems[i]["id"]))
        if i and i % 800 == 0:
            log(f"similarity {i}/{total}")

    for problem, best in zip(problems, heaps):
        ranked = sorted(best, key=lambda item: (-item[0], -item[1], -item[2], item[3]))
        problem["similar"] = [{"id": problem_id, "score": round(score, 3)} for score, _overlap, _near, problem_id in ranked]


def _seriate(slugs: list[str], counts: dict[str, set[str]], related: dict[str, dict[str, float]]) -> list[str]:
    """Insert each tag beside the placed tag it overlaps with most.

    Large tags are placed first so specific techniques can settle next to
    the broader topics they belong with.
    """
    by_size = sorted(slugs, key=lambda slug: (-len(counts[slug]), slug))
    order = [by_size[0]]
    for slug in by_size[1:]:
        best_at = len(order)
        best_key = (0.0, 0.0)
        attached = False
        for index, left in enumerate(order):
            right = order[(index + 1) % len(order)]
            left_score = related.get(slug, {}).get(left, 0.0)
            right_score = related.get(slug, {}).get(right, 0.0) if len(order) > 1 else 0.0
            key = (left_score + right_score, max(left_score, right_score))
            if key > best_key:
                best_key = key
                best_at = index + 1
                attached = True
        if not attached:
            order.append(slug)
        else:
            order.insert(best_at, slug)
    return order


def layout_tags(problems: list[dict], names: dict[str, str]) -> list[dict]:
    """Place tags on a ring, with related tags beside each other.

    Relatedness is the overlap coefficient, shared problems divided by the
    smaller tag. Arc length grows with sqrt(count) so a large cluster has
    room for its bubbles.
    """
    counts: dict[str, set[str]] = defaultdict(set)
    for problem in problems:
        for tag in problem["tags"]:
            counts[tag].add(problem["id"])
    slugs = sorted(counts)
    if not slugs:
        return []

    related: dict[str, dict[str, float]] = defaultdict(dict)
    for left_i, left in enumerate(slugs):
        left_set = counts[left]
        for right in slugs[left_i + 1 :]:
            inter = len(left_set & counts[right])
            if inter < 2:
                continue
            score = inter / min(len(left_set), len(counts[right]))
            if score < 0.18:
                continue
            related[left][right] = score
            related[right][left] = score

    order = _seriate(slugs, counts, related)
    packs = {slug: 22 + 4.05 * math.sqrt(len(counts[slug])) for slug in slugs}
    gap = 34.0
    count_n = len(order)
    circumference = sum(
        packs[order[i]] + packs[order[(i + 1) % count_n]] + gap for i in range(count_n)
    )
    radius = circumference / (2 * math.pi)
    angle = -math.pi / 2
    coords: dict[str, tuple[float, float]] = {}
    for index, slug in enumerate(order):
        coords[slug] = (math.cos(angle) * radius, math.sin(angle) * radius)
        nxt = order[(index + 1) % count_n]
        angle += (packs[slug] + packs[nxt] + gap) / radius

    preview = [slug for slug in order if len(counts[slug]) >= 80]
    log(
        f"{count_n} tags on a ring of radius {radius:.0f}; "
        f"large-tag order: {', '.join(preview[:28])}"
    )
    return [
        {
            "slug": slug,
            "name": names.get(slug, display_name(slug)),
            "count": len(counts[slug]),
            "x": coords[slug][0],
            "y": coords[slug][1],
            "color": tag_color(slug),
        }
        for slug in slugs
    ]


def layout_problems(problems: list[dict], tags: list[dict]) -> None:
    by_slug = {tag["slug"]: tag for tag in tags}
    n_problems = max(1, len(problems))
    weights = {}
    for tag in tags:
        weights[tag["slug"]] = math.log((n_problems + 1) / (tag["count"] + 1)) + 0.2

    if tags:
        untagged_x = 0.0
        untagged_y = max(tag["y"] for tag in tags) + 560
    else:
        untagged_x, untagged_y = 0.0, 0.0

    for problem in problems:
        usable = [slug for slug in problem["tags"] if slug in by_slug]
        if not usable:
            anchor_x, anchor_y = untagged_x, untagged_y
        else:
            weight_sum = sum(weights[slug] for slug in usable)
            anchor_x = sum(by_slug[slug]["x"] * weights[slug] for slug in usable) / weight_sum
            anchor_y = sum(by_slug[slug]["y"] * weights[slug] for slug in usable) / weight_sum
        problem["ax"] = anchor_x
        problem["ay"] = anchor_y
        jitter = fnv(problem["id"])
        angle = (jitter % 10000) / 10000 * 2 * math.pi
        radius = 3 + (jitter % 1000) / 1000 * 14
        problem["x"] = anchor_x + math.cos(angle) * radius
        problem["y"] = anchor_y + math.sin(angle) * radius

    minimum = 7.2
    cell = minimum
    pull_steps = 100
    total_steps = 180
    indexed = list(enumerate(problems))
    for step in range(total_steps):
        if step < pull_steps:
            pull = 0.11
            for problem in problems:
                problem["x"] += (problem["ax"] - problem["x"]) * pull
                problem["y"] += (problem["ay"] - problem["y"]) * pull
        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for index, problem in indexed:
            grid[(math.floor(problem["x"] / cell), math.floor(problem["y"] / cell))].append(index)
        for index, problem in indexed:
            gx = math.floor(problem["x"] / cell)
            gy = math.floor(problem["y"] / cell)
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    for other_index in grid.get((gx + ox, gy + oy), []):
                        if other_index <= index:
                            continue
                        other = problems[other_index]
                        dx = problem["x"] - other["x"]
                        dy = problem["y"] - other["y"]
                        dist_sq = dx * dx + dy * dy
                        if dist_sq >= minimum * minimum:
                            continue
                        dist = math.sqrt(dist_sq) if dist_sq > 1e-8 else 0.01
                        push = (minimum - dist) / 2
                        ux, uy = dx / dist, dy / dist
                        problem["x"] += ux * push
                        problem["y"] += uy * push
                        other["x"] -= ux * push
                        other["y"] -= uy * push

    drift = 0.0
    for problem in problems:
        drift += math.hypot(problem["x"] - problem["ax"], problem["y"] - problem["ay"])
    log(f"mean drift from tag anchor {drift / max(1, len(problems)):.1f}")

    close = 0
    for problem in problems:
        problem["x"] = round(problem["x"], 2)
        problem["y"] = round(problem["y"], 2)
        problem.pop("ax", None)
        problem.pop("ay", None)
    # Sample nearest-neighbor gaps to spot a collapsed layout.
    probe = problems[:: max(1, len(problems) // 400)]
    for problem in probe:
        nearest = min(
            (math.hypot(problem["x"] - other["x"], problem["y"] - other["y"]) for other in problems if other is not problem),
            default=999,
        )
        if nearest < minimum * 0.75:
            close += 1
    log(f"layout probe: {close}/{len(probe)} sampled problems still overlap")


def build_payload(problems: list[dict], tags: list[dict]) -> dict:
    problems.sort(key=sort_key)
    tags = sorted(tags, key=lambda tag: (-tag["count"], tag["slug"]))
    for tag in tags:
        tag["x"] = round(tag["x"], 2)
        tag["y"] = round(tag["y"], 2)
    difficulty_counts = {name: 0 for name in DIFFICULTIES}
    tagged = 0
    for problem in problems:
        difficulty_counts[problem["difficulty"]] = difficulty_counts.get(problem["difficulty"], 0) + 1
        if problem["tags"]:
            tagged += 1
    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "https://leetcode.com/graphql problemsetQuestionList",
        "problemCount": len(problems),
        "similarity": {
            "metric": "jaccard",
            "difficultyBoost": DIFFICULTY_BOOST,
            "neighbors": NEIGHBORS,
            "minScore": MIN_NEIGHBOR_SCORE,
            "summary": (
                "Jaccard overlap of topic tags, plus 0.05 when both problems "
                "share a difficulty band (capped at 1)."
            ),
        },
        "difficultyCounts": difficulty_counts,
        "taggedCount": tagged,
        "tags": tags,
        "problems": problems,
    }


def write_payload(payload: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    log(f"wrote {DATA_PATH} ({DATA_PATH.stat().st_size / 1_000_000:.1f} MB, {payload['problemCount']} problems)")


def print_samples(problems: list[dict]) -> None:
    by_id = {problem["id"]: problem for problem in problems}
    for problem_id in ("1", "198", "200", "3", "121"):
        problem = by_id.get(problem_id)
        if not problem:
            continue
        neighbors = ", ".join(
            f"{item['id']}:{item['score']:.2f}" for item in problem["similar"][:5]
        )
        log(f"#{problem['id']} {problem['title']} [{', '.join(problem['tags'])}] -> {neighbors}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Recompute similarity and layout from data/problems.json without scraping",
    )
    args = parser.parse_args()

    if args.offline:
        problems, names = load_existing()
        log(f"loaded {len(problems)} problems from {DATA_PATH}")
    else:
        problems, names = scrape_problems()
    problems = merge_extras(problems, names, load_extras())
    log("computing similarity")
    compute_similarity(problems)
    log("laying out tags and problems")
    tags = layout_tags(problems, names)
    for tag in tags:
        tag["x"] = round(tag["x"], 2)
        tag["y"] = round(tag["y"], 2)
    layout_problems(problems, tags)
    payload = build_payload(problems, tags)
    write_payload(payload)
    print_samples(problems)


if __name__ == "__main__":
    main()
