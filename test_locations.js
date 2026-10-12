// Checks the location split/join round-trip: node test_locations.js
import assert from 'assert';
import { splitLoc, joinLoc } from './src/views.js';

// the display string the user asked for
assert.equal(joinLoc('Regal 1', 'Shelve 1'), 'Regal 1 - Shelve 1');

// round-trip: what the dropdowns read back is what they wrote
const r = splitLoc(joinLoc('Regal 1', 'Shelve 1'));
assert.deepEqual(r, { main: 'Regal 1', secondary: 'Shelve 1' });

// main chosen, shelf not yet: no dangling separator
assert.equal(joinLoc('Regal 1', ''), 'Regal 1');
assert.deepEqual(splitLoc('Regal 1'), { main: 'Regal 1', secondary: '' });

// nothing chosen, and the legacy free-text rows already in the DB
assert.equal(joinLoc('', ''), '');
assert.deepEqual(splitLoc(''), { main: '', secondary: '' });
assert.deepEqual(splitLoc(null), { main: '', secondary: '' });
assert.deepEqual(splitLoc('afaf'), { main: 'afaf', secondary: '' });

// a hyphen inside a name is fine, only the padded ' - ' separates
assert.deepEqual(splitLoc(joinLoc('Regal-A', 'Shelve-2')), { main: 'Regal-A', secondary: 'Shelve-2' });

console.log('location split/join ok');
