/* LeetCode Clusters
   Positions and similarity scores are precomputed in data/problems.json.
   Score = |shared tags| / |tags on either problem|, plus 0.05 when the
   difficulty band matches (capped at 1). See scripts/scrape_and_compute.py.
*/

const DIFFS = ["Easy", "Medium", "Hard"];
const rootStyle = getComputedStyle(document.documentElement);
const cssVar = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
const DIFF_COLOR = {
  Easy: cssVar("--easy", "#3ddc97"),
  Medium: cssVar("--medium", "#ffc14d"),
  Hard: cssVar("--hard", "#ff6b81"),
};
const BG = cssVar("--bg", "#0c1020");

const canvas = document.querySelector("#view");
const ctx = canvas.getContext("2d");
const statusEl = document.querySelector("#status");
const emptyEl = document.querySelector("#empty");
const emptyTitle = document.querySelector("#empty-title");
const emptyCopy = document.querySelector("#empty-copy");
const tooltipEl = document.querySelector("#tooltip");
const loadingEl = document.querySelector("#loading");
const tagListEl = document.querySelector("#tag-list");
const searchEl = document.querySelector("#search");
const tagSearchEl = document.querySelector("#tag-search");
const snapshotEl = document.querySelector("#snapshot");
const tagsPanel = document.querySelector("#tags-panel");
const scrim = document.querySelector("#scrim");

const detailEmpty = document.querySelector("#detail-empty");
const detailBody = document.querySelector("#detail-body");
const detailKicker = document.querySelector("#detail-kicker");
const detailTitle = document.querySelector("#detail-title");
const detailHidden = document.querySelector("#detail-hidden-note");
const detailTags = document.querySelector("#detail-tags");
const detailOpen = document.querySelector("#detail-open");
const detailSimilar = document.querySelector("#detail-similar");

const state = {
  problems: [],
  byId: new Map(),
  tags: [],
  tagBySlug: new Map(),
  clusterDistance: 18,
  minGroupSize: 6,
  clusterId: null,
  spatialClusters: [],
  spatialById: new Map(),
  spatialMembership: new Map(),
  view: "clusters",
  clusterSort: "count",
  problemSort: "id",
  query: "",
  tagQuery: "",
  diffs: new Set(DIFFS),
  tagsSelected: new Set(),
  mode: "all",
  linksOn: true,
  activeId: null,
  hoverId: null,
  base: [],
  highlighted: [],
  ghosts: [],
  visibleIds: new Set(),
  grid: new Map(),
  camX: 0,
  camY: 0,
  camK: 1,
  width: 1,
  height: 1,
};

const pointers = new Map();
let drag = null;
let pinch = null;
let frame = 0;
let tagButtons = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function worldToScreen(x, y) {
  return {
    x: (x - state.camX) * state.camK + state.width / 2,
    y: (y - state.camY) * state.camK + state.height / 2,
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - state.width / 2) / state.camK + state.camX,
    y: (y - state.height / 2) / state.camK + state.camY,
  };
}

function emphasizeMatches() {
  return state.highlighted.length > 0
    && state.highlighted.length <= 40
    && (state.tagsSelected.size > 0 || state.clusterId || state.query.trim() || state.diffs.size < DIFFS.length);
}

function radiusFor(kind) {
  const scaled = clamp(5.1 * state.camK, 1.8, 18);
  if (kind === "hot" && emphasizeMatches()) return Math.max(scaled, 7);
  return scaled;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tagName(slug) {
  return state.tagBySlug.get(slug)?.name || slug;
}

function selectedTagNames() {
  return [...state.tagsSelected].map(tagName);
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (["clusters", "problems", "map"].includes(params.get("view"))) state.view = params.get("view");
  if (["count", "name", "hard", "small"].includes(params.get("cs"))) state.clusterSort = params.get("cs");
  if (["id", "title", "difficulty", "hard"].includes(params.get("ps"))) state.problemSort = params.get("ps");
  const minimum = Number(params.get("minSize"));
  if (params.has("minSize") && Number.isInteger(minimum) && minimum >= 3) state.minGroupSize = minimum;
  const distance = Number(params.get("distance"));
  if (params.has("distance") && Number.isFinite(distance)) state.clusterDistance = clamp(distance, 8, 120);
  state.clusterId = params.get("cluster") || null;
  if (params.has("q")) state.query = params.get("q") || "";
  if (params.has("diff")) {
    const next = (params.get("diff") || "").split(",").filter((diff) => DIFFS.includes(diff));
    state.diffs = new Set(next);
  }
  if (params.has("tags")) {
    state.tagsSelected = new Set((params.get("tags") || "").split(",").filter(Boolean));
  }
  if (params.get("mode") === "any") state.mode = "any";
  if (params.get("links") === "0") state.linksOn = false;
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.minGroupSize !== 6) params.set("minSize", state.minGroupSize);
  if (state.clusterDistance !== 18) params.set("distance", state.clusterDistance);
  if (state.clusterId) params.set("cluster", state.clusterId);
  if (state.view !== "clusters") params.set("view", state.view);
  if (state.clusterSort !== "count") params.set("cs", state.clusterSort);
  if (state.problemSort !== "id") params.set("ps", state.problemSort);
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.diffs.size < DIFFS.length) params.set("diff", [...state.diffs].join(","));
  if (state.tagsSelected.size) params.set("tags", [...state.tagsSelected].join(","));
  if (state.mode !== "all") params.set("mode", state.mode);
  if (!state.linksOn) params.set("links", "0");
  const next = params.toString();
  const base = `${location.pathname}${location.search}`;
  history.replaceState(null, "", next ? `${base}#${next}` : base);
}

function syncControls() {
  searchEl.value = state.query;
  document.querySelector("#links-toggle").checked = state.linksOn;
  for (const button of document.querySelectorAll(".diff-group button")) {
    button.setAttribute("aria-pressed", String(state.diffs.has(button.dataset.diff)));
  }
  document.querySelector("#mode-all").setAttribute("aria-pressed", String(state.mode === "all"));
  document.querySelector("#mode-any").setAttribute("aria-pressed", String(state.mode === "any"));
  for (const button of tagButtons) {
    const on = state.tagsSelected.has(button.dataset.slug);
    button.setAttribute("aria-pressed", String(on));
  }
  document.querySelector("#clear-tags").hidden = state.tagsSelected.size === 0;
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  const selected = [...state.tagsSelected];
  const base = [];
  for (const problem of state.problems) {
    if (!state.diffs.has(problem.difficulty)) continue;
    if (query) {
      const haystack = `${problem.id} ${problem.title} ${problem.slug}`.toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    base.push(problem);
  }
  const highlighted = [];
  const ghosts = [];
  for (const problem of base) {
    let match = true;
    if (selected.length) {
      match = state.mode === "all"
        ? selected.every((tag) => problem.tagSet.has(tag))
        : selected.some((tag) => problem.tagSet.has(tag));
    }
    if (state.clusterId) match = match && Boolean(state.spatialById.get(state.clusterId)?.ids.has(problem.id));
    if (match) highlighted.push(problem);
    else ghosts.push(problem);
  }
  state.base = base;
  state.highlighted = selected.length || state.clusterId ? highlighted : base;
  state.ghosts = selected.length || state.clusterId ? ghosts : [];
  state.visibleIds = new Set(base.map((problem) => problem.id));
}

function updateTagCounts() {
  const counts = new Map();
  for (const problem of state.base) {
    for (const tag of problem.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const query = state.tagQuery.trim().toLowerCase();
  for (const button of tagButtons) {
    const slug = button.dataset.slug;
    button.querySelector(".count").textContent = (counts.get(slug) || 0).toLocaleString();
    const selected = state.tagsSelected.has(slug);
    const matches = !query || button.dataset.name.includes(query);
    button.hidden = !selected && !matches;
  }
}

function describeSelection() {
  const count = state.highlighted.length;
  const tags = selectedTagNames();
  const query = state.query.trim();
  const joiner = state.mode === "all" ? " ∩ " : " ∪ ";
  const diffNote = state.diffs.size === DIFFS.length ? "" : [...state.diffs].join(" + ");
  let text;
  if (state.diffs.size === 0) text = "No difficulties selected";
  else if (query && tags.length) text = `${count.toLocaleString()} match “${query}” in ${tags.join(joiner)}`;
  else if (tags.length) text = `${count.toLocaleString()} in ${tags.join(joiner)}`;
  else if (query) text = `${count.toLocaleString()} match “${query}”`;
  else if (state.clusterId) text = `${count.toLocaleString()} in ${state.spatialById.get(state.clusterId)?.name || "spatial cluster"}`;
  else if (diffNote) text = `${count.toLocaleString()} ${diffNote} problems`;
  else text = `${state.problems.length.toLocaleString()} problems`;
  if (diffNote && state.diffs.size > 0 && (query || tags.length)) text += ` · ${diffNote}`;
  if (state.ghosts.length && count) text += ` · ${state.ghosts.length.toLocaleString()} dimmed`;
  return text;
}

function emptyMessage() {
  if (state.diffs.size === 0) {
    return ["All difficulties are off", "Turn at least one difficulty back on, or reset the filters."];
  }
  if (state.tagsSelected.size && state.mode === "all") {
    return ["No problems in this intersection", "These tags do not occur together inside the current search."];
  }
  if (state.query.trim()) {
    return ["No matching titles", `Nothing matches “${state.query.trim()}”.`];
  }
  return ["Nothing to show", "No problems match these filters."];
}

function updateStatus() {
  statusEl.textContent = describeSelection();
  const count = state.highlighted.length;
  emptyEl.hidden = count !== 0;
  if (count === 0) {
    const [title, copy] = emptyMessage();
    emptyTitle.textContent = title;
    emptyCopy.textContent = copy;
  }
  document.querySelector("#clear-tags").hidden = state.tagsSelected.size === 0;
}

function refresh({ refit = false, hash = true } = {}) {
  applyFilters();
  updateTagCounts();
  syncControls();
  updateStatus();
  renderBrowser();
  if (state.view === "map") resize();
  if (hash) writeHash();
  if (refit) fit(state.highlighted.length ? state.highlighted : state.base);
  else draw();
  if (state.activeId) renderDetail(state.byId.get(state.activeId));
}

function fit(nodes) {
  if (!nodes.length || state.width < 2 || state.height < 2) {
    draw();
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const dx = Math.max(80, maxX - minX);
  const dy = Math.max(80, maxY - minY);
  state.camK = clamp(Math.min((state.width - 70) / dx, (state.height - 90) / dy), 0.03, 5);
  state.camX = (minX + maxX) / 2;
  state.camY = (minY + maxY) / 2;
  draw();
}

function focusProblem(problem) {
  state.camX = problem.x;
  state.camY = problem.y;
  state.camK = clamp(Math.max(state.camK, 1.15), 0.03, 5);
  draw();
}

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  state.camK = clamp(state.camK * factor, 0.03, 6);
  const after = screenToWorld(sx, sy);
  state.camX += before.x - after.x;
  state.camY += before.y - after.y;
  draw();
}

function onScreen(x, y, margin = 30) {
  const point = worldToScreen(x, y);
  return point.x >= -margin && point.y >= -margin && point.x <= state.width + margin && point.y <= state.height + margin;
}

function buildGrid() {
  const cell = 18;
  const grid = new Map();
  for (const problem of state.problems) {
    const key = `${Math.floor(problem.x / cell)},${Math.floor(problem.y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(problem);
    else grid.set(key, [problem]);
  }
  state.grid = grid;
  state.cell = cell;
}

function pick(sx, sy) {
  const world = screenToWorld(sx, sy);
  const reach = Math.max(8, (radiusFor("hot") + 6) / state.camK);
  const cell = state.cell || 18;
  const cx = Math.floor(world.x / cell);
  const cy = Math.floor(world.y / cell);
  const span = Math.ceil(reach / cell);
  let best = null;
  let bestDist = reach * reach;
  for (let ox = -span; ox <= span; ox += 1) {
    for (let oy = -span; oy <= span; oy += 1) {
      const bucket = state.grid.get(`${cx + ox},${cy + oy}`);
      if (!bucket) continue;
      for (const problem of bucket) {
        if (!state.visibleIds.has(problem.id)) continue;
        const dx = problem.x - world.x;
        const dy = problem.y - world.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          best = problem;
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

function collectMesh() {
  if (!state.linksOn) return [];
  const pool = state.highlighted.filter((problem) => onScreen(problem.x, problem.y, 40));
  if (pool.length === 0 || pool.length > 240) return [];
  const ids = new Set(pool.map((problem) => problem.id));
  const lines = [];
  const seen = new Set();
  for (const problem of pool) {
    for (const link of problem.similar) {
      if (link.score < 0.4 || !ids.has(link.id)) continue;
      const key = problem.id < link.id ? `${problem.id}|${link.id}` : `${link.id}|${problem.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ a: problem, b: state.byId.get(link.id), score: link.score, hot: false });
    }
  }
  return lines;
}

function collectHoverLinks(problem) {
  if (!state.linksOn || !problem) return [];
  const lines = [];
  for (const link of problem.similar) {
    const other = state.byId.get(link.id);
    if (!other || !state.visibleIds.has(other.id)) continue;
    lines.push({ a: problem, b: other, score: link.score, hot: true });
  }
  return lines;
}

function drawBubbles(list, alpha, kind) {
  const radius = radiusFor(kind);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const diff of DIFFS) {
    ctx.beginPath();
    let any = false;
    for (const problem of list) {
      if (problem.difficulty !== diff) continue;
      const point = worldToScreen(problem.x, problem.y);
      if (point.x < -20 || point.y < -20 || point.x > state.width + 20 || point.y > state.height + 20) continue;
      ctx.moveTo(point.x + radius, point.y);
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      any = true;
    }
    if (!any) continue;
    ctx.fillStyle = DIFF_COLOR[diff];
    ctx.fill();
    if (alpha > 0.5 && radius >= 3.2) {
      ctx.strokeStyle = "rgba(6, 8, 16, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLinks(lines) {
  for (const line of lines) {
    const a = worldToScreen(line.a.x, line.a.y);
    const b = worldToScreen(line.b.x, line.b.y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = line.hot
      ? `rgba(232, 240, 255, ${0.35 + line.score * 0.55})`
      : `rgba(168, 196, 255, ${0.12 + line.score * 0.4})`;
    ctx.lineWidth = line.hot ? 1.6 : 1;
    ctx.stroke();
  }
}

function drawMembership(problem) {
  if (!problem) return;
  const origin = worldToScreen(problem.x, problem.y);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.4;
  for (const slug of problem.tags) {
    const tag = state.tagBySlug.get(slug);
    if (!tag) continue;
    const point = worldToScreen(tag.x, tag.y);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = hexToRgba(tag.color || "#9ebfff", 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClouds() {
  if (!state.tagsSelected.size) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const slug of state.tagsSelected) {
    const tag = state.tagBySlug.get(slug);
    if (!tag) continue;
    const point = worldToScreen(tag.x, tag.y);
    const radius = Math.max(54, 130 * state.camK);
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, hexToRgba(tag.color || "#9ebfff", 0.34));
    gradient.addColorStop(1, hexToRgba(tag.color || "#9ebfff", 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawLabels() {
  const labels = [];
  const minCount = state.camK < 0.18 ? 150 : state.camK < 0.4 ? 40 : 1;
  for (const tag of state.tags) {
    if (!onScreen(tag.x, tag.y, 20)) continue;
    if (tag.count < minCount && !state.tagsSelected.has(tag.slug)) continue;
    labels.push(tag);
  }
  const untagged = state.problems.filter((problem) => problem.tags.length === 0 && state.visibleIds.has(problem.id));
  if (untagged.length) {
    const x = untagged.reduce((sum, problem) => sum + problem.x, 0) / untagged.length;
    const y = untagged.reduce((sum, problem) => sum + problem.y, 0) / untagged.length;
    labels.push({ slug: "", name: "No topic tags", count: untagged.length, x, y, color: "#95a3c2", pinned: false });
  }
  labels.sort((a, b) => {
    const aSel = state.tagsSelected.has(a.slug) ? 1 : 0;
    const bSel = state.tagsSelected.has(b.slug) ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    return b.count - a.count;
  });
  const placed = [];
  ctx.save();
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const tag of labels) {
    const point = worldToScreen(tag.x, tag.y);
    const text = tag.name;
    const width = ctx.measureText(text).width + 14;
    const height = 20;
    const box = { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height };
    const pinned = state.tagsSelected.has(tag.slug);
    const blocked = placed.some((other) => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
    if (blocked && !pinned) continue;
    placed.push(box);
    roundRect(box.x, box.y, box.w, box.h, 7);
    ctx.fillStyle = "rgba(10, 14, 28, 0.78)";
    ctx.fill();
    ctx.fillStyle = tag.color || "#d5deea";
    ctx.fillText(text, point.x, point.y + 0.5);
  }
  ctx.restore();
}

function drawRing(problem, color, extra = 3.5) {
  if (!problem) return;
  const point = worldToScreen(problem.x, problem.y);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radiusFor("hot") + extra, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function paint() {
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, state.width, state.height);
  if (!state.problems.length) return;
  drawClouds();
  drawLinks(collectMesh());
  const hover = state.byId.get(state.hoverId);
  const active = state.byId.get(state.activeId);
  drawLinks(collectHoverLinks(hover || active));
  drawMembership(hover || active);
  if (state.ghosts.length) drawBubbles(state.ghosts, 0.13, "ghost");
  drawBubbles(state.highlighted, 1, "hot");
  if (emphasizeMatches()) {
    for (const problem of state.highlighted) drawRing(problem, "rgba(255,255,255,0.9)", 3.5);
  }
  drawRing(active, "rgba(255,255,255,0.9)", 4);
  if (hover && hover !== active) drawRing(hover, "rgba(255,255,255,0.55)", 3.2);
  drawLabels();
  drawMatchLabels();
}

function drawMatchLabels() {
  if (!emphasizeMatches() || state.highlighted.length > 12) return;
  const placed = [];
  ctx.save();
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const problem of state.highlighted) {
    const point = worldToScreen(problem.x, problem.y);
    const text = problem.title.length > 46 ? `${problem.title.slice(0, 44)}…` : problem.title;
    const boxWidth = ctx.measureText(text).width + 14;
    const boxHeight = 20;
    const box = {
      x: point.x - boxWidth / 2,
      y: point.y - radiusFor("hot") - 16 - boxHeight / 2,
      w: boxWidth,
      h: boxHeight,
    };
    const blocked = placed.some((other) => box.x < other.x + other.w + 4 && box.x + box.w + 4 > other.x && box.y < other.y + other.h + 4 && box.y + box.h + 4 > other.y);
    if (blocked) continue;
    placed.push(box);
    roundRect(box.x, box.y, box.w, box.h, 7);
    ctx.fillStyle = "rgba(10, 14, 28, 0.9)";
    ctx.fill();
    ctx.fillStyle = "#f4f7ff";
    ctx.fillText(text, point.x, box.y + boxHeight / 2 + 0.5);
  }
  ctx.restore();
}

function draw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    paint();
  });
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const nextW = Math.round(width * dpr);
  const nextH = Math.round(height * dpr);
  state.width = width;
  state.height = height;
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw();
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function showTooltip(problem, clientX, clientY) {
  tooltipEl.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${problem.id}. ${problem.title}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = problem.paid ? `${problem.difficulty} · Premium` : problem.difficulty;
  meta.style.color = DIFF_COLOR[problem.difficulty];
  const chips = document.createElement("div");
  chips.className = "chips";
  const tags = problem.tags.length ? problem.tags : ["no topic tags"];
  for (const slug of tags) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = slug === "no topic tags" ? slug : tagName(slug);
    chips.append(chip);
  }
  tooltipEl.append(title, meta, chips);
  tooltipEl.hidden = false;
  const pad = 14;
  const width = tooltipEl.offsetWidth;
  const height = tooltipEl.offsetHeight;
  let left = clientX + pad;
  let top = clientY + pad;
  if (left + width > window.innerWidth - 8) left = clientX - width - pad;
  if (top + height > window.innerHeight - 8) top = clientY - height - pad;
  tooltipEl.style.left = `${Math.max(8, left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
}

function renderDetail(problem) {
  const panel = document.querySelector("#detail-panel");
  panel.classList.toggle("has-problem", Boolean(problem));
  if (!problem) {
    detailBody.hidden = true;
    detailEmpty.hidden = false;
    return;
  }
  detailEmpty.hidden = true;
  detailBody.hidden = false;
  detailKicker.textContent = problem.paid ? `#${problem.id} · ${problem.difficulty} · Premium` : `#${problem.id} · ${problem.difficulty}`;
  detailKicker.style.color = DIFF_COLOR[problem.difficulty];
  detailTitle.textContent = problem.title;
  detailHidden.hidden = state.visibleIds.has(problem.id);
  detailOpen.href = problem.url;
  detailTags.replaceChildren();
  if (!problem.tags.length) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "No topic tags";
    detailTags.append(chip);
  }
  for (const slug of problem.tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = tagName(slug);
    chip.setAttribute("aria-pressed", String(state.tagsSelected.has(slug)));
    chip.addEventListener("click", () => toggleTag(slug, { refit: true }));
    detailTags.append(chip);
  }
  detailSimilar.replaceChildren();
  if (!problem.similar.length) {
    const item = document.createElement("li");
    item.className = "hint";
    item.textContent = "No close tag-overlap neighbors in this snapshot.";
    detailSimilar.append(item);
    return;
  }
  for (const link of problem.similar) {
    const other = state.byId.get(link.id);
    if (!other) continue;
    const shared = problem.tags.filter((tag) => other.tagSet.has(tag)).map(tagName);
    const sameTags = shared.length > 0 && shared.length === problem.tags.length && problem.tags.length === other.tags.length;
    const row = document.createElement("li");
    row.className = "similar-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "similar";
    const title = document.createElement("span");
    title.textContent = `${other.id}. ${other.title}`;
    const meta = document.createElement("span");
    meta.className = "meta";
    const percent = Math.round(link.score * 100);
    if (sameTags) meta.textContent = `100% · same tags: ${shared.join(", ")}`;
    else if (shared.length) meta.textContent = `${percent}% · ${shared.join(", ")}`;
    else meta.textContent = `${percent}%`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      state.activeId = other.id;
      renderDetail(other);
      focusProblem(other);
    });
    const open = document.createElement("a");
    open.className = "open-mini";
    open.href = other.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "↗";
    open.setAttribute("aria-label", `Open ${other.title} on LeetCode`);
    row.append(button, open);
    detailSimilar.append(row);
  }
}

function setActive(problem) {
  state.activeId = problem.id;
  renderDetail(problem);
}

function toggleTag(slug, { refit = false } = {}) {
  browserPage = 0;
  if (state.tagsSelected.has(slug)) state.tagsSelected.delete(slug);
  else state.tagsSelected.add(slug);
  refresh({ refit });
}

function openTags(open) {
  tagsPanel.classList.toggle("open", open);
  scrim.hidden = !open;
}

function resetFilters() {
  document.querySelector("#cluster-search").value = "";
  browserPage = 0;
  state.clusterId = null;
  state.query = "";
  state.tagQuery = "";
  tagSearchEl.value = "";
  state.diffs = new Set(DIFFS);
  state.tagsSelected = new Set();
  state.mode = "all";
  state.linksOn = true;
  refresh({ refit: true });
}

function openProblem(problem) {
  window.open(problem.url, "_blank", "noopener,noreferrer");
}

function buildTagList() {
  tagListEl.replaceChildren();
  tagButtons = state.tags.map((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-row";
    button.dataset.slug = tag.slug;
    button.dataset.name = `${tag.name} ${tag.slug}`.toLowerCase();
    button.style.setProperty("--chip", tag.color);
    button.setAttribute("aria-pressed", "false");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = tag.color;
    const name = document.createElement("span");
    name.className = "tag-name";
    name.textContent = tag.name;
    const count = document.createElement("span");
    count.className = "count";
    button.append(swatch, name, count);
    button.addEventListener("click", () => toggleTag(tag.slug, { refit: true }));
    tagListEl.append(button);
    return button;
  });
}

function bind() {
  bindBrowser();
  searchEl.addEventListener("input", () => {
    state.query = searchEl.value;
    refresh({ refit: true });
  });
  tagSearchEl.addEventListener("input", () => {
    state.tagQuery = tagSearchEl.value;
    updateTagCounts();
  });
  for (const button of document.querySelectorAll(".diff-group button")) {
    button.addEventListener("click", () => {
      const diff = button.dataset.diff;
      if (state.diffs.has(diff)) state.diffs.delete(diff);
      else state.diffs.add(diff);
      refresh({ refit: true });
    });
  }
  document.querySelector("#mode-all").addEventListener("click", () => {
    state.mode = "all";
    refresh({ refit: true });
  });
  document.querySelector("#mode-any").addEventListener("click", () => {
    state.mode = "any";
    refresh({ refit: true });
  });
  document.querySelector("#links-toggle").addEventListener("change", (event) => {
    state.linksOn = event.target.checked;
    refresh({ refit: false });
  });
  document.querySelector("#reset").addEventListener("click", resetFilters);
  document.querySelector("#empty-reset").addEventListener("click", resetFilters);
  document.querySelector("#clear-tags").addEventListener("click", () => {
    state.tagsSelected.clear();
    refresh({ refit: true });
  });
  document.querySelector("#zoom-in").addEventListener("click", () => zoomAt(state.width / 2, state.height / 2, 1.2));
  document.querySelector("#zoom-out").addEventListener("click", () => zoomAt(state.width / 2, state.height / 2, 1 / 1.2));
  document.querySelector("#zoom-fit").addEventListener("click", () => fit(state.highlighted.length ? state.highlighted : state.base));
  document.querySelector("#detail-focus").addEventListener("click", () => {
    const problem = state.byId.get(state.activeId);
    if (problem) focusProblem(problem);
  });
  document.querySelector("#detail-close").addEventListener("click", () => {
    state.activeId = null;
    state.hoverId = null;
    renderDetail(null);
    hideTooltip();
    draw();
  });
  document.querySelector("#tags-toggle").addEventListener("click", () => openTags(!tagsPanel.classList.contains("open")));
  document.querySelector("#tags-close").addEventListener("click", () => openTags(false));
  scrim.addEventListener("click", () => openTags(false));

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = {
        x: event.clientX,
        y: event.clientY,
        camX: state.camX,
        camY: state.camY,
        moved: false,
        pointerType: event.pointerType,
      };
      pinch = null;
    } else if (pointers.size === 2) {
      drag = null;
      const [a, b] = [...pointers.values()];
      pinch = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        k: state.camK,
      };
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const rect = canvas.getBoundingClientRect();
      const sx = (a.x + b.x) / 2 - rect.left;
      const sy = (a.y + b.y) / 2 - rect.top;
      const next = clamp(pinch.k * (dist / pinch.dist), 0.03, 6);
      zoomAt(sx, sy, next / state.camK);
      return;
    }
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (dx * dx + dy * dy > 9) drag.moved = true;
      state.camX = drag.camX - dx / state.camK;
      state.camY = drag.camY - dy / state.camK;
      canvas.classList.add("is-dragging");
      hideTooltip();
      draw();
      return;
    }
    const problem = pick(event.offsetX, event.offsetY);
    state.hoverId = problem ? problem.id : null;
    canvas.classList.toggle("is-pointing", Boolean(problem));
    if (problem && event.pointerType !== "touch") {
      showTooltip(problem, event.clientX, event.clientY);
      if (state.activeId !== problem.id) setActive(problem);
    } else {
      hideTooltip();
    }
    draw();
  });

  function endPointer(event) {
    const info = drag;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      canvas.classList.remove("is-dragging");
    }
    if (!info || info.moved || event.type === "pointercancel") return;
    const problem = pick(event.offsetX, event.offsetY);
    if (!problem) return;
    if (info.pointerType === "touch") {
      const again = state.activeId === problem.id;
      setActive(problem);
      focusProblem(problem);
      hideTooltip();
      if (again) openProblem(problem);
      return;
    }
    setActive(problem);
    openProblem(problem);
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => {
    if (drag) return;
    state.hoverId = null;
    canvas.classList.remove("is-pointing");
    hideTooltip();
    draw();
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= state.height;
    zoomAt(event.offsetX, event.offsetY, Math.exp(-delta * 0.0014));
  }, { passive: false });

  document.addEventListener("keydown", (event) => {
    const typing = event.target.matches("input, textarea, select, button, a, [contenteditable]");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      searchEl.focus();
      searchEl.select();
    }
    if (event.key === "Escape") {
      openTags(false);
      state.hoverId = null;
      hideTooltip();
      draw();
    }
    if (typing || state.view !== "map") return;
    if (event.key === "+" || event.key === "=") zoomAt(state.width / 2, state.height / 2, 1.18);
    if (event.key === "-" || event.key === "_") zoomAt(state.width / 2, state.height / 2, 1 / 1.18);
    if (event.key === "0") fit(state.highlighted.length ? state.highlighted : state.base);
    if (event.key === "Enter" && state.activeId) openProblem(state.byId.get(state.activeId));
    const step = 48 / state.camK;
    if (event.key === "ArrowLeft") { state.camX -= step; draw(); event.preventDefault(); }
    if (event.key === "ArrowRight") { state.camX += step; draw(); event.preventDefault(); }
    if (event.key === "ArrowUp") { state.camY -= step; draw(); event.preventDefault(); }
    if (event.key === "ArrowDown") { state.camY += step; draw(); event.preventDefault(); }
  });

  window.addEventListener("resize", resize);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas.parentElement);
  }
}

function showLoadError(message) {
  loadingEl.hidden = false;
  loadingEl.querySelector(".card").textContent = message;
}

async function main() {
  bind();
  readHash();
  resize();
  let payload;
  try {
    const response = await fetch("data/problems.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (error) {
    showLoadError("Could not load data/problems.json. From the repo root run: python3 -m http.server 5173");
    console.error(error);
    return;
  }
  state.problems = payload.problems || [];
  state.tags = payload.tags || [];
  for (const problem of state.problems) {
    problem.tagSet = new Set(problem.tags || []);
    problem.similar = problem.similar || [];
    state.byId.set(problem.id, problem);
  }
  for (const tag of state.tags) state.tagBySlug.set(tag.slug, tag);
  state.tagsSelected = new Set([...state.tagsSelected].filter((slug) => state.tagBySlug.has(slug)));
  for (const diff of DIFFS) {
    const count = payload.difficultyCounts?.[diff] || state.problems.filter((problem) => problem.difficulty === diff).length;
    document.querySelector(`#count-${diff.toLowerCase()}`).textContent = count.toLocaleString();
  }
  const when = payload.generatedAt ? new Date(payload.generatedAt) : null;
  const whenText = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "unknown date";
  snapshotEl.textContent = `${state.problems.length.toLocaleString()} problems · snapshot ${whenText}. Titles and tags come from the public LeetCode problemset. Not affiliated with LeetCode.`;
  rebuildSpatialClusters();
  buildGrid();
  buildTagList();
  loadingEl.hidden = true;
  refresh({ refit: true, hash: false });
}

main();
