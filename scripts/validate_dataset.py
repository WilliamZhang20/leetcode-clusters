#!/usr/bin/env python3
"""Check data/problems.json before it is published."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "problems.json"
DIFFICULTIES = {"Easy", "Medium", "Hard"}


def fail(message: str) -> None:
    raise SystemExit(f"dataset invalid: {message}")


def main() -> None:
    if not DATA_PATH.exists():
        fail(f"missing {DATA_PATH}")
    payload = json.loads(DATA_PATH.read_text())
    problems = payload.get("problems")
    tags = payload.get("tags")
    if not isinstance(problems, list) or not isinstance(tags, list):
        fail("problems and tags must be arrays")
    if payload.get("problemCount") != len(problems):
        fail("problemCount does not match problems")
    if len(problems) < 3000:
        fail(f"expected the full problemset, found {len(problems)}")
    if len(tags) < 40:
        fail(f"expected dozens of topic tags, found {len(tags)}")
    similarity = payload.get("similarity") or {}
    if similarity.get("metric") != "jaccard":
        fail("similarity metric must be jaccard")
    if not payload.get("generatedAt"):
        fail("missing generatedAt")

    tag_slugs = set()
    xs = []
    ys = []
    for tag in tags:
        for key in ("slug", "name", "count", "x", "y", "color"):
            if key not in tag:
                fail(f"tag missing {key}")
        tag_slugs.add(tag["slug"])
        xs.append(tag["x"])
        ys.append(tag["y"])
    if max(xs) - min(xs) < 200 or max(ys) - min(ys) < 200:
        fail("tag layout collapsed")

    ids = set()
    tagged = 0
    with_neighbors = 0
    positions = set()
    for problem in problems:
        for key in ("id", "title", "slug", "difficulty", "tags", "url", "paid", "x", "y", "similar"):
            if key not in problem:
                fail(f"problem {problem.get('id')} missing {key}")
        problem_id = str(problem["id"])
        if problem_id in ids:
            fail(f"duplicate id {problem_id}")
        ids.add(problem_id)
        if problem["difficulty"] not in DIFFICULTIES:
            fail(f"{problem_id} has difficulty {problem['difficulty']}")
        if not isinstance(problem["tags"], list):
            fail(f"{problem_id} tags must be a list")
        if len(problem["tags"]) != len(set(problem["tags"])):
            fail(f"{problem_id} has duplicate tags")
        if problem["tags"]:
            tagged += 1
        for tag in problem["tags"]:
            if tag not in tag_slugs:
                fail(f"{problem_id} references unknown tag {tag}")
        url = problem["url"]
        if not (isinstance(url, str) and url.startswith("https://leetcode.com/problems/") and url.endswith("/")):
            fail(f"{problem_id} has a bad url")
        if not isinstance(problem["paid"], bool):
            fail(f"{problem_id} paid must be a boolean")
        if not isinstance(problem["x"], (int, float)) or not isinstance(problem["y"], (int, float)):
            fail(f"{problem_id} has a non-numeric position")
        positions.add((round(problem["x"], 1), round(problem["y"], 1)))
        if not isinstance(problem["similar"], list):
            fail(f"{problem_id} similar must be a list")
        if problem["similar"]:
            with_neighbors += 1
        for neighbor in problem["similar"]:
            score = neighbor.get("score")
            if neighbor.get("id") == problem_id:
                fail(f"{problem_id} lists itself as similar")
            if not isinstance(score, (int, float)) or not 0 < score <= 1:
                fail(f"{problem_id} has a bad similarity score")

    missing = [neighbor["id"] for problem in problems for neighbor in problem["similar"] if neighbor["id"] not in ids]
    if missing:
        fail(f"similar ids missing from the dataset, for example {missing[0]}")
    if tagged / len(problems) < 0.85:
        fail("too many problems have no tags")
    if with_neighbors / len(problems) < 0.7:
        fail("too few problems have similarity neighbors")
    if len(positions) < len(problems) * 0.9:
        fail("problem positions collapsed")

    two_sum = next((problem for problem in problems if problem["id"] == "1"), None)
    if not two_sum or two_sum["title"] != "Two Sum":
        fail("missing Two Sum")
    if "array" not in two_sum["tags"] or "hash-table" not in two_sum["tags"]:
        fail("Two Sum tags changed unexpectedly")
    if two_sum["url"] != "https://leetcode.com/problems/two-sum/":
        fail("Two Sum url is wrong")
    islands = next((problem for problem in problems if problem["id"] == "200"), None)
    if not islands:
        fail("missing Number of Islands")
    print(f"ok {len(problems)} problems, {len(tags)} tags, {tagged} tagged")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
