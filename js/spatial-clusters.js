/* Single-linkage clustering in the precomputed map's coordinate system.
   A spatial grid avoids comparing every pair. Threshold is independent of zoom. */
function computeSpatialClusters(problems, distance, minimumSize = 3) {
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('Distance must be positive');
  const grid = new Map();
  const key = (x, y) => `${x},${y}`;
  for (let i = 0; i < problems.length; i++) {
    const p = problems[i], cell = key(Math.floor(p.x / distance), Math.floor(p.y / distance));
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(i);
  }
  const seen = new Set(), clusters = [], ungrouped = [];
  for (let i = 0; i < problems.length; i++) {
    if (seen.has(i)) continue;
    seen.add(i);
    const queue = [i], members = [];
    for (let head = 0; head < queue.length; head++) {
      const p = problems[queue[head]];
      members.push(p);
      const cx = Math.floor(p.x / distance), cy = Math.floor(p.y / distance);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(key(cx + dx, cy + dy)) || []) {
          if (seen.has(j)) continue;
          const other = problems[j];
          if ((p.x - other.x) ** 2 + (p.y - other.y) ** 2 <= distance ** 2) {
            seen.add(j); queue.push(j);
          }
        }
      }
    }
    members.sort((a,b) => a.id.localeCompare(b.id, 'en', {numeric:true}));
    if (members.length >= minimumSize) clusters.push({id: `c-${members[0].id}`, members});
    else ungrouped.push(...members);
  }
  return {clusters, ungrouped};
}
if (typeof module !== 'undefined') module.exports = {computeSpatialClusters};
