// Checks grouping + name direction: node test_sort.js
import assert from 'assert';
import { sortRows } from './src/views.js';

const parts = [
  { name: '100 Ohm 1%', category: 'resistor', package: '0805' },
  { name: '22 Ohm 1%', category: 'resistor', package: '0805' },
  { name: 'Tweezers', category: 'tool', package: null },
  { name: '0 Ohm', category: 'resistor', package: '0603' },
  { name: 'ec360', category: 'capacitor', package: '0805' },
  { name: 'EC100', category: 'capacitor', package: '0805' }
];
const order = (dir) => sortRows(parts, dir).map((p) => p.name).join(' | ');

// category is the primary group, package the secondary, name only sorts inside them
assert.equal(
  order('asc'),
  'EC100 | ec360 | 0 Ohm | 22 Ohm 1% | 100 Ohm 1% | Tweezers',
  'asc: capacitor < resistor < tool, and 0603 before 0805 inside resistor'
);

// Z-A flips names only — the groups stay put and in the same order
assert.equal(
  order('desc'),
  'ec360 | EC100 | 0 Ohm | 100 Ohm 1% | 22 Ohm 1% | Tweezers',
  'desc: group order unchanged, names reversed within each group'
);

// natural numeric compare, not lexicographic
assert.ok(
  order('asc').indexOf('22 Ohm 1%') < order('asc').indexOf('100 Ohm 1%'),
  '22 sorts before 100'
);

// a null package must not throw and must group together
assert.doesNotThrow(() => sortRows([{ name: 'a' }, { name: 'b' }]));
assert.equal(sortRows([]).length, 0);

// the input array is not mutated
const before = parts.map((p) => p.name).join();
sortRows(parts, 'desc');
assert.equal(parts.map((p) => p.name).join(), before, 'sortRows does not mutate its input');

console.log('sort order ok');
