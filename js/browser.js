/* Text-first browsing uses the same dataset and filters as the map. */
let browserPage = 0;
const PAGE_SIZE = 50;
const el = (id) => document.getElementById(id);
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function changeView(view) {
  state.view = view;
  renderBrowser();
  writeHash();
  if (view === 'map') { resize(); fit(state.highlighted.length ? state.highlighted : state.base); }
}
function browseCluster(slug) {
  state.clusterId = null;
  state.tagsSelected = new Set([slug]);
  browserPage = 0;
  state.view = 'problems';
  refresh({ refit: true });
  openTags(false);
}
function renderBrowser() {
  el("clear-cluster").hidden = !state.clusterId;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  el('directory-panel').hidden = state.view !== 'clusters';
  el('problems-panel').hidden = state.view !== 'problems';
  el('map-panel').hidden = state.view !== 'map';
  el('cluster-sort').value = state.clusterSort;
  el('problem-sort').value = state.problemSort;
  if (state.view === 'clusters') renderClusters();
  if (state.view === 'problems') renderProblems();
}
function rebuildSpatialClusters() {
  const {clusters, ungrouped} = computeSpatialClusters(state.problems, state.clusterDistance);
  const globalCounts = new Map();
  for (const p of state.problems) for (const tag of p.tags) globalCounts.set(tag, (globalCounts.get(tag) || 0) + 1);
  state.spatialClusters = clusters.map(cluster => {
    const counts = new Map();
    for (const p of cluster.members) for (const tag of p.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    // Describe the group using enriched tags; names do not determine membership.
    const topics = [...counts].filter(([,n]) => n >= cluster.members.length * 0.3)
      .sort((a,b) => (b[1] / globalCounts.get(b[0])) - (a[1] / globalCounts.get(a[0])) || b[1] - a[1]);
    const slugs = topics.slice(0, 3).map(([slug]) => slug);
    return {...cluster, ids: new Set(cluster.members.map(p => p.id)),
      name: slugs.map(tagName).join(' + ') || 'Mixed topics',
      color: state.tagBySlug.get(slugs[0])?.color || '#9ebfff'};
  });
  state.spatialById = new Map(state.spatialClusters.map(c => [c.id, c]));
  state.spatialById.set('ungrouped', {id:'ungrouped', name:'Ungrouped problems', members:ungrouped, ids:new Set(ungrouped.map(p => p.id)), color:'#95a3c2'});
  state.spatialMembership = new Map();
  for (const c of state.spatialById.values()) for (const p of c.members) state.spatialMembership.set(p.id, c.id);
  if (!state.spatialById.has(state.clusterId)) state.clusterId = null;
}
function openSpatialCluster(id, view = 'problems') {
  state.clusterId = id;
  state.view = view;
  browserPage = 0;
  refresh({refit:true});
  openTags(false);
}
function clusterPreview(members, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 220 80');
  svg.setAttribute('class', 'cluster-preview');
  svg.setAttribute('aria-hidden', 'true');
  const xs = members.map(p => p.x), ys = members.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const scale = Math.min(204 / Math.max(1, Math.max(...xs) - minX), 64 / Math.max(1, Math.max(...ys) - minY));
  for (const p of members) {
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('cx', 8 + (p.x - minX) * scale);
    circle.setAttribute('cy', 8 + (p.y - minY) * scale);
    circle.setAttribute('r', '2.5');
    circle.setAttribute('fill', DIFF_COLOR[p.difficulty] || color);
    svg.append(circle);
  }
  return svg;
}
function renderClusters() {
  el('cluster-min-size').value = state.minGroupSize;
  el('cluster-distance').value = state.clusterDistance;
  el('distance-value').textContent = state.clusterDistance;
  const query = el('cluster-search').value.trim().toLowerCase();
  const selected = [...state.tagsSelected];
  const matching = new Set(state.base.filter(p => !selected.length || (state.mode === 'all'
    ? selected.every(t => p.tagSet.has(t)) : selected.some(t => p.tagSet.has(t)))).map(p => p.id));
  const groups = state.spatialClusters.map(c => ({...c, visible:c.members.filter(p => matching.has(p.id))}))
    .filter(c => c.members.length >= state.minGroupSize && c.visible.length && (!query || `${c.name} ${c.id} ${c.members.map(p => p.title + ' ' + p.id).join(' ')}`.toLowerCase().includes(query)));
  const hard = c => c.visible.filter(p => p.difficulty === 'Hard').length;
  groups.sort((a,b) => {
    if (state.clusterSort === 'name') return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    if (state.clusterSort === 'hard') return hard(b) - hard(a) || a.id.localeCompare(b.id);
    if (state.clusterSort === 'small') return a.visible.length - b.visible.length || a.id.localeCompare(b.id);
    return b.visible.length - a.visible.length || a.id.localeCompare(b.id);
  });
  const ungrouped = state.spatialById.get('ungrouped');
  el('cluster-summary').textContent = `${groups.length} matching spatial clusters · at least ${state.minGroupSize} members · distance ${state.clusterDistance} · ${ungrouped.members.filter(p => matching.has(p.id)).length} ungrouped problems. Topic names describe groups; positions determine membership.`;
  const cards = groups.map(c => {
    const card = node('article', undefined, 'cluster-card');
    card.style.setProperty('--cluster-color', c.color);
    card.append(node('p', c.id.toUpperCase(), 'eyebrow'), node('h3', c.name), clusterPreview(c.members, c.color), node('p', `${c.visible.length.toLocaleString()} / ${c.members.length} problems`, 'cluster-count'));
    const bar = node('div', undefined, 'difficulty-bar'); bar.setAttribute('aria-hidden','true');
    const breakdown = node('div', undefined, 'breakdown');
    for (const diff of DIFFS) {
      const count = c.visible.filter(p => p.difficulty === diff).length;
      const segment = node('span', undefined, diff.toLowerCase());
      segment.style.width = `${count / c.visible.length * 100}%`; bar.append(segment);
      breakdown.append(node('span', `${count} ${diff}`, diff.toLowerCase()));
    }
    const samples = node('p', c.members.slice(0,3).map(p => p.title).join(' · '), 'hint');
    const actions = node('div', undefined, 'cluster-actions');
    for (const [view, label] of [['problems','Browse problems'],['map','Show on map']]) {
      const button = node('button', label, 'ghost'); button.type = 'button';
      button.addEventListener('click', () => openSpatialCluster(c.id, view)); actions.append(button);
    }
    card.append(bar, breakdown, samples, actions); return card;
  });
  el('cluster-cards').replaceChildren(...cards);
  if (!cards.length) el('cluster-cards').append(node('p', 'No spatial clusters match these filters. Try another search, lower the minimum group size, or increase the grouping distance.', 'hint'));
  const loose = node('button', `Browse ungrouped problems (${ungrouped.members.filter(p => matching.has(p.id)).length})`, 'ghost'); loose.type='button';
  loose.addEventListener('click', () => openSpatialCluster('ungrouped'));
  el('cluster-cards').append(loose);
}
function renderProblems() {
  const problems = [...state.highlighted];
  const numeric = (a,b) => a.id.localeCompare(b.id, undefined, {numeric: true});
  problems.sort((a,b) => {
    if (state.problemSort === 'title') return a.title.localeCompare(b.title) || numeric(a,b);
    if (state.problemSort === 'difficulty' || state.problemSort === 'hard') {
      const delta = DIFFS.indexOf(a.difficulty) - DIFFS.indexOf(b.difficulty);
      return delta * (state.problemSort === 'hard' ? -1 : 1) || numeric(a,b);
    }
    return numeric(a,b);
  });
  const pages = Math.max(1, Math.ceil(problems.length / PAGE_SIZE));
  browserPage = Math.min(browserPage, pages - 1);
  el('list-title').textContent = state.clusterId ? `${state.clusterId.toUpperCase()} · ${state.spatialById.get(state.clusterId).name}` : state.tagsSelected.size ? selectedTagNames().join(state.mode === 'all' ? ' ∩ ' : ' ∪ ') : 'All problems';
  el('list-summary').textContent = `${problems.length.toLocaleString()} matching problems · select a title to open LeetCode`;
  const chips = [...state.tagsSelected].map(slug => {
    const chip = node('button', `${tagName(slug)} ×`, 'tag-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', `Remove ${tagName(slug)} filter`);
    chip.addEventListener('click', () => { state.tagsSelected.delete(slug); browserPage = 0; refresh(); });
    return chip;
  });
  if (state.clusterId) {
    const chip = node('button', 'Clear spatial cluster ×', 'tag-chip'); chip.type = 'button';
    chip.addEventListener('click', () => { state.clusterId = null; browserPage = 0; refresh({refit:true}); });
    chips.unshift(chip);
    const map = node('button', 'Show cluster on map', 'tag-chip'); map.type = 'button';
    map.addEventListener('click', () => changeView('map')); chips.push(map);
  }
  el('selection-chips').replaceChildren(...chips);
  const rows = problems.slice(browserPage * PAGE_SIZE, (browserPage + 1) * PAGE_SIZE).map(p => {
    const row = node('tr');
    const titleCell = node('td');
    const link = node('a', p.title);
    link.href = p.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    titleCell.append(link);
    if (p.paid) titleCell.append(node('span', ' Premium', 'premium'));
    const tags = node('td');
    const wrap = node('div', undefined, 'chip-row');
    for (const slug of p.tags) {
      const chip = node('button', tagName(slug), 'tag-chip'); chip.type = 'button';
      chip.addEventListener('click', () => browseCluster(slug)); wrap.append(chip);
    }
    tags.append(wrap);
    const explore = node('td');
    const detail = node('button', 'Details', 'ghost'); detail.type = 'button';
    detail.setAttribute('aria-label', `Explore ${p.title}`);
    detail.addEventListener('click', () => setActive(p));
    explore.append(detail);
    row.append(node('td', p.id), titleCell, node('td', p.difficulty, p.difficulty.toLowerCase()), tags, explore);
    return row;
  });
  el('problem-rows').replaceChildren(...rows);
  el('list-empty').hidden = problems.length > 0;
  el('page-label').textContent = `Page ${browserPage + 1} of ${pages}`;
  el('page-prev').disabled = browserPage === 0;
  el('page-next').disabled = browserPage >= pages - 1;
}
function bindBrowser() {
  el('cluster-min-size').addEventListener('input', e => {
    const value = Number(e.target.value);
    if (!Number.isSafeInteger(value) || value < 3) return;
    state.minGroupSize = value; renderClusters(); writeHash();
  });
  el("clear-cluster").addEventListener("click", () => { state.clusterId = null; browserPage = 0; refresh({refit:true}); });
  el('cluster-distance').addEventListener('input', e => { el('distance-value').textContent = e.target.value; });
  el('cluster-distance').addEventListener('change', e => {
    state.clusterDistance = Number(e.target.value);
    state.clusterId = null; browserPage = 0;
    rebuildSpatialClusters(); refresh({refit:true});
  });
  el('detail-cluster').addEventListener('click', () => {
    const id = state.spatialMembership.get(state.activeId);
    if (id) openSpatialCluster(id);
  });
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => changeView(button.dataset.view));
  el('cluster-search').addEventListener('input', renderClusters);
  el('cluster-sort').addEventListener('change', e => { state.clusterSort = e.target.value; renderClusters(); writeHash(); });
  el('problem-sort').addEventListener('change', e => { state.problemSort = e.target.value; browserPage = 0; renderProblems(); writeHash(); });
  el('page-prev').addEventListener('click', () => { browserPage--; renderProblems(); });
  el('page-next').addEventListener('click', () => { browserPage++; renderProblems(); });
  // Filters start a new result set, so return to its first page.
  for (const id of ['search', 'reset', 'clear-tags', 'mode-all', 'mode-any', 'empty-reset']) el(id).addEventListener(id === 'search' ? 'input' : 'click', () => { browserPage = 0; });
  document.querySelector('.diff-group').addEventListener('click', () => { browserPage = 0; renderBrowser(); });
  el('detail-focus').addEventListener('click', () => changeView('map'));
}
