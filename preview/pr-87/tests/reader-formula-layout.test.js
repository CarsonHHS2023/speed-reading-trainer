const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function declarationBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test('formula layout keeps oversized equations reachable while centering equations that fit', () => {
  const css = fs.readFileSync('reader-formula.css', 'utf8');
  const scroller = declarationBlock(css, '.reader-v2-formula');
  const display = declarationBlock(css, '.reader-v2-formula .katex-display');

  assert.match(scroller, /display:\s*block\s*;/);
  assert.match(scroller, /overflow-x:\s*auto\s*;/);
  assert.doesNotMatch(scroller, /justify-content:\s*center\s*;/);

  assert.match(display, /width:\s*max-content\s*;/);
  assert.match(display, /min-width:\s*100%\s*;/);
  assert.match(display, /margin:\s*0\s*;/);
  assert.match(display, /text-align:\s*center\s*;/);
});
