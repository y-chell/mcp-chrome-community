import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Functions passed to chrome.scripting.executeScript({ func }) are serialized and run inside the
// page. If the build target is below es2017, esbuild rewrites `async` into the bundle-level
// `__async` helper (and object spread into `__spreadValues`). Those helpers do not exist in the
// page, so the injected call throws and executeScript silently returns `null`. Unit tests run
// untranspiled source and cannot catch this, so guard the config itself.
describe('extension build target', () => {
  it('keeps async/spread native so injected functions stay self-contained', () => {
    const config = readFileSync(resolve(__dirname, '../wxt.config.ts'), 'utf8');
    const match = config.match(/\btarget:\s*'es(\d{4}|next)'/);
    expect(match).not.toBeNull();
    const year = match![1] === 'next' ? Infinity : Number(match![1]);
    expect(year).toBeGreaterThanOrEqual(2018);
  });
});
