const assert = require('node:assert/strict');
const {computeSpatialClusters} = require('../js/spatial-clusters.js');
const point = (id,x,y=0) => ({id:String(id),x,y});
// Threshold is inclusive, transitive, and independent of input ordering.
const points = [point(1,0),point(2,10),point(3,20),point(4,100),point(5,110),point(6,120),point(7,1000)];
const grouped = computeSpatialClusters(points,10);
assert.deepEqual(grouped.clusters.map(c=>c.members.map(p=>p.id)), [['1','2','3'],['4','5','6']]);
assert.deepEqual(grouped.ungrouped.map(p=>p.id), ['7']);
assert.deepEqual(computeSpatialClusters(points.slice().reverse(),10).clusters.map(c=>c.id).sort(), ['c-1','c-4']);
assert.equal(computeSpatialClusters(points,9.99).clusters.length,0);
assert.equal(computeSpatialClusters(points,80).clusters.length,1);
assert.equal(computeSpatialClusters([],10).clusters.length,0);
assert.throws(()=>computeSpatialClusters(points,0));
// Diagonal adjacent grid cells and negative coordinates must connect correctly.
assert.equal(computeSpatialClusters([point(1,-1,-1),point(2,0,0),point(3,1,1)],1.5).clusters.length,1);
// Snapshot partitions every problem exactly once, with no duplicates.
const data = require('../data/problems.json').problems;
for (const distance of [8,18,60,120]) {
  const start = performance.now();
  const result = computeSpatialClusters(data,distance);
  const members = [...result.clusters.flatMap(c=>c.members),...result.ungrouped];
  assert.equal(members.length,data.length);
  assert.equal(new Set(members.map(p=>p.id)).size,data.length);
  assert.ok(result.clusters.every(c=>c.members.length>=3));
  console.log(`${distance} units: ${result.clusters.length} clusters, ${result.ungrouped.length} ungrouped, ${Math.round(performance.now()-start)} ms`);
}
console.log('Spatial clustering checks passed');
