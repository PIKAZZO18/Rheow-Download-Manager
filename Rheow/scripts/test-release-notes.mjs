import assert from 'node:assert/strict';
import { plainReleaseNotes } from '../src/utils/releaseNotes.ts';

const cleanMarkdown = `This release adds **bulk delete** and \`Settings → Updates\`.

### Added

- **Bulk delete.** Select any number of downloads.
- **What's new.** A one-time window shows the changelog.

### Fixed

- **Bulk Resume** now starts immediately.
`;

const clean = plainReleaseNotes(cleanMarkdown);
assert.ok(clean.startsWith('This release adds bulk delete and Settings → Updates.'));
assert.ok(clean.includes('\n\nAdded\n\n• Bulk delete. Select any number of downloads.'));
assert.ok(clean.includes('\n\nFixed\n\n• Bulk Resume now starts immediately.'));
assert.ok(!clean.includes('###'));
assert.ok(!clean.includes('**'));
assert.ok(!clean.includes('`'));

const wrapped = plainReleaseNotes(
  '{"value" => "Settings â†’ Updates at 1000Ã—600\\n\\n### Fixed\\n\\n- **Bulk Resume** works."}',
);
assert.equal(wrapped, 'Settings → Updates at 1000×600\n\nFixed\n\n• Bulk Resume works.');

const jsonObject = plainReleaseNotes(
  JSON.stringify({ value: 'Line one\n\n### Added\n\n- **Bold** item with `code`.' }),
);
assert.equal(jsonObject, 'Line one\n\nAdded\n\n• Bold item with code.');

const jsonString = plainReleaseNotes(JSON.stringify('Line one\n\n### Added\n\n- **Bold** item'));
assert.equal(jsonString, 'Line one\n\nAdded\n\n• Bold item');

assert.equal(plainReleaseNotes('Settings → Updates at 1000×600 — done.'), 'Settings → Updates at 1000×600 — done.');
assert.equal(plainReleaseNotes(''), '');

console.log('release notes: 6 cases passed');
