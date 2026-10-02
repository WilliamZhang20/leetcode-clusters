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
  state.tagsSelected = new Set([slug]);
  browserPage = 0;
  state.view = 'problems';
  refresh({ refit: true });
  openTags(false);
}
function renderBrowser() {
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  el('directory-panel').hidden = state.view !== 'clusters';
  el('problems-panel').hidden = state.view !== 'problems';
  el('map-panel').hidden = state.view !== 'map';
  el('cluster-sort').value = state.clusterSort;
  el('problem-sort').value = state.problemSort;
  if (state.view === 'clusters') renderClusters();
  if (state.view === 'problems') renderProblems();
}
function renderClusters() {
  const counts = new Map(state.tags.map(t => [t.slug, { Easy: 0, Medium: 0, Hard: 0, total: 0 }]));
  for (const p of state.highlighted) for (const slug of p.tags) {
    const c = counts.get(slug);
    if (c) { c[p.difficulty]++; c.total++; }
  }
  const query = el('cluster-search').value.trim().toLowerCase();
  const tags = state.tags.filter(t => `${t.name} ${t.slug}`.toLowerCase().includes(query));
  const nameCompare = (a,b) => a.name.localeCompare(b.name);
  tags.sort((a,b) => {
    const ca = counts.get(a.slug), cb = counts.get(b.slug);
    if (state.clusterSort === 'name') return nameCompare(a,b);
    if (state.clusterSort === 'small') return ca.total - cb.total || nameCompare(a,b);
    if (state.clusterSort === 'hard') return cb.Hard - ca.Hard || nameCompare(a,b);
    return cb.total - ca.total || nameCompare(a,b);
  });
  el('cluster-summary').textContent = `${tags.length} clusters · ${state.highlighted.length.toLocaleString()} matching problems · counts reflect the current filters`;
  const cards = tags.map(tag => {
    const c = counts.get(tag.slug);
    const card = node('button', undefined, 'cluster-card');
    card.type = 'button';
    card.style.setProperty('--cluster-color', tag.color);
    card.append(node('h3', tag.name), node('p', `${c.total.toLocaleString()} problems`, 'cluster-count'));
    const bar = node('div', undefined, 'difficulty-bar');
    bar.setAttribute('aria-hidden', 'true');
    for (const diff of DIFFS) {
      const segment = node('span', undefined, diff.toLowerCase());
      segment.style.width = `${c.total ? c[diff] / c.total * 100 : 0}%`;
      bar.append(segment);
    }
    const breakdown = node('div', undefined, 'breakdown');
    for (const diff of DIFFS) breakdown.append(node('span', `${c[diff]} ${diff}`, diff.toLowerCase()));
    card.append(bar, breakdown, node('span', 'Browse problems →', 'cluster-link'));
    card.addEventListener('click', () => browseCluster(tag.slug));
    return card;
  });
  el('cluster-cards').replaceChildren(...cards);
  if (!cards.length) el('cluster-cards').append(node('p', 'No clusters match this name. Try another search.', 'hint'));
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
  el('list-title').textContent = state.tagsSelected.size ? selectedTagNames().join(state.mode === 'all' ? ' ∩ ' : ' ∪ ') : 'All problems';
  el('list-summary').textContent = `${problems.length.toLocaleString()} matching problems · select a title to open LeetCode`;
  const chips = [...state.tagsSelected].map(slug => {
    const chip = node('button', `${tagName(slug)} ×`, 'tag-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', `Remove ${tagName(slug)} filter`);
    chip.addEventListener('click', () => { state.tagsSelected.delete(slug); browserPage = 0; refresh(); });
    return chip;
  });
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
