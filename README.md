# LeetCode Clusters

An interactive map of **every LeetCode problem**. Bubbles that sit near each other share topic tags. A problem belongs to every tag it carries, so questions with several tags rest between those clusters instead of being forced into a single bucket.

The map is a static site. Similarity scores and positions are computed ahead of time, and the page only needs a browser.

Published site: [https://williamzhang20.github.io/leetcode-clusters/](https://williamzhang20.github.io/leetcode-clusters/)

The site updates when this repository’s `main` branch changes. GitHub Pages is already set to deploy from GitHub Actions.

## Run locally

Python’s standard library is enough. From the repository root:

```bash
python3 -m http.server 5173
```

Open [http://localhost:5173](http://localhost:5173). Fetching `data/problems.json` needs HTTP, so opening `index.html` directly from disk will not load the map.

## Browse spatial clusters and problems

The page opens in **Map** by default. The **Clusters** tab groups nearby bubbles using the map's precomputed `x`/`y` coordinates. **Grouping distance** controls the threshold in map units, independent of zoom. Two problems within that distance connect; connected components of at least three problems become clusters. This is single-linkage clustering: members can connect through a chain, so the threshold is not a maximum cluster diameter. Singletons and pairs are listed separately under **Ungrouped problems**.

The default distance is 18, which produces 255 spatial clusters in the current snapshot. Smaller thresholds tighten groups; larger thresholds merge neighborhoods. Topic names describe each group using tags enriched relative to the whole dataset; they do not determine membership, and these groups are not curated solution-pattern classifications. IDs use the lowest problem number in the group. Each card includes a miniature map and sample titles to distinguish groups with similar topic labels.

**Minimum total group size** hides small groups without changing membership. It defaults to 6 (more than 5 members) and accepts any integer of at least 3. The cutoff uses the group’s total membership, not its remaining members after other filters. Search by group topics, member title, or problem number. Sort by matching size, name, or Hard-problem count. Counts follow the title search, difficulty switches, and selected-tag intersection/union. Membership is computed on the full dataset so filters do not silently regroup the map. Cards show matching / total members.

**Browse problems** opens the exact members in a sortable, paginated table. **Show on map** highlights those members and fits the camera to the matching group. In a problem's detail panel, **Browse nearby cluster** opens its spatial group. Topic chips continue to act as broad tag filters. Clear the spatial group independently using the sidebar button or the chip above the list.

View, grouping distance, minimum group size, selected cluster, filters, and sort order are included in the URL hash. Changing the threshold clears the selected cluster because membership may change. On mobile, the Tags button opens the filter sidebar.

## How to read the map

- **Color** is difficulty: green Easy, amber Medium, rose Hard.
- **Nearness** means the problems share specific topic tags. Rarer tags pull harder than broad ones, so Array does not swallow the whole map.
- **Dashed lines** on hover connect a problem to each of its tag clusters. That is the overlap: one bubble, several memberships.
- **Solid lines** are high similarity scores. They appear for the bubble under the pointer, and between neighbors when you have zoomed or filtered to a readable neighborhood.
- **Tag selection** highlights membership without clearing the map. Dimmed bubbles are outside the selection.
  - **Match all** is the intersection. Array and Two Pointers highlights only problems that carry both.
  - **Match any** is the union.
- **Search** and the difficulty switches hide non-matches.
- **Click** a bubble to open it on LeetCode in a new tab. On a phone, tap once to inspect and tap the same bubble again to open it.
- Drag to pan, scroll or pinch to zoom. `+`, `-`, and `0` zoom and fit. `/` focuses search.

The current filter is stored in the URL hash, so a view can be shared.

## Similarity

Two problems are similar when their topic tags overlap. The score is Jaccard similarity:

```text
score = |tags(A) ∩ tags(B)| / |tags(A) ∪ tags(B)|
```

If that score is above zero and both problems are in the same difficulty band, add `0.05` and cap the result at `1`. Shared tags decide the grouping. The difficulty bump is only a nudge, and it never links two problems that share no tags.

Each problem keeps its 8 strongest neighbors with a score of at least `0.20`.

## Clusters and placement

Topic tags anchor the map layout. A problem is a member of each tag on its record. The directory derives spatial clusters from the finished positions using the grouping-distance threshold above.

Tags sit on a ring. The order is a walk that steps to the most closely related remaining tag, so techniques that co-occur end up side by side. Relatedness for that walk is the overlap coefficient: shared problems divided by the size of the smaller tag. That keeps a specific technique next to the broader topic it usually appears with. Each tag gets an arc long enough for its own problems, so Array has a wide section and a rare tag has a small one.

A problem is then placed at the weighted center of its tags:

```text
weight(tag) = ln((N + 1) / (count(tag) + 1)) + 0.2
position(problem) = sum(weight(tag) * position(tag)) / sum(weights)
```

`N` is the number of problems. A rare technique outweighs a broad tag, so a question tagged Sliding Window and Array sits with Sliding Window, nudged toward Array. A question whose tags are neighbors on the ring lands in that part of the ring. A question whose tags are far apart is drawn inward, between them. A short collision pass separates bubbles that would otherwise stack, without abandoning the anchor.

`x` and `y` in the dataset are that finished layout. The page does not recompute it.

Each problem keeps up to eight neighbors. If more than eight share the same score, the snapshot keeps the ones whose titles also share words, then nearer problem numbers. That only breaks ties. It does not change the score.

## Dataset

`data/problems.json` is the full public problemset: LeetCode id, title, slug, difficulty, tag slugs, url, premium flag, map position, and closest neighbors. Tag names and colors live in the `tags` array. The file is generated and stored compactly so the page can load it. The snapshot date is the `generatedAt` field.

Titles and tags come from LeetCode’s public problemset GraphQL API (`problemsetQuestionList`). No API key is required. This project is not affiliated with LeetCode.

Refresh the snapshot (network required, Python 3.10+):

```bash
python3 scripts/scrape_and_compute.py
python3 scripts/validate_dataset.py
```

The scraper pages through every problem, recomputes similarity, and rewrites positions. Commit the updated `data/problems.json`.

### Add or correct a problem

Custom records live in `data/extra-problems.json` (create it; it is not required). It is a JSON array. On every scrape, and on an offline recompute, these records are merged by `id`. A matching id replaces the scraped problem, so a future refresh does not drop your edit. A new id is added.

```json
[
  {
    "id": "1",
    "title": "Two Sum",
    "slug": "two-sum",
    "difficulty": "Easy",
    "tags": ["array", "hash-table"],
    "url": "https://leetcode.com/problems/two-sum/",
    "paid": false
  }
]
```

- `id` is the LeetCode frontend id, as a string.
- `difficulty` is `Easy`, `Medium`, or `Hard`.
- `tags` is the full list of topic slugs. When it is non-empty it replaces the previous list. Use the slug, not the display name (`hash-table`, not `Hash Table`).
- Include `url`. If you omit it and set `slug`, the script fills `https://leetcode.com/problems/<slug>/`.

Then recompute without hitting the network:

```bash
python3 scripts/scrape_and_compute.py --offline
```

`--offline` reads `data/problems.json`, merges extras, and rewrites `similar`, `x`, and `y`. Do not hand-edit those generated fields; the next run replaces them.

A full `python3 scripts/scrape_and_compute.py` rebuilds from LeetCode first, then applies the same extras file. Put lasting additions there, not only in `problems.json`.

## GitHub Pages

Pages for this repository deploys with GitHub Actions (the Pages source is a workflow, not a branch folder).

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) does two things:

1. On pull requests and on `main`, it runs `scripts/validate_dataset.py`.
2. On a push to `main` (and when the workflow is run manually), it publishes `index.html`, `css/`, `js/`, and `data/` to GitHub Pages.

The public URL is [https://williamzhang20.github.io/leetcode-clusters/](https://williamzhang20.github.io/leetcode-clusters/). The first deploy happens after the workflow runs on `main`.

## Project layout

```text
index.html                     page
css/styles.css                 layout and theme
js/app.js                      map, filters, hover, and links
js/browser.js                  cluster directory and paginated problem list
js/spatial-clusters.js         distance grouping using a spatial grid
data/problems.json             full problemset, similarity, and positions
scripts/scrape_and_compute.py  scrape LeetCode and compute the layout
scripts/validate_dataset.py    sanity checks used locally and in Actions
.github/workflows/pages.yml    validate and publish to GitHub Pages
```
