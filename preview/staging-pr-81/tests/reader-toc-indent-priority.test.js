const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

test('applies toc indentation as important inline padding', () => {
  const declarations = [];
  const rendered = {
    dataset: {},
    style: {
      setProperty(name, value, priority) {
        declarations.push([name, value, priority]);
      },
    },
  };

  Integration.applyImportantPaddingLeft(rendered, 4.5);

  assert.equal(rendered.dataset.readerTocIndent, '4.5');
  assert.deepEqual(declarations, [
    ['padding-left', '4.5%', 'important'],
    ['box-sizing', 'border-box', 'important'],
  ]);
});

test('falls back to paddingLeft for lightweight test DOMs', () => {
  const rendered = { dataset: {}, style: {} };

  Integration.applyImportantPaddingLeft(rendered, 3);

  assert.equal(rendered.dataset.readerTocIndent, '3');
  assert.equal(rendered.style.paddingLeft, '3%');
  assert.equal(rendered.style.boxSizing, 'border-box');
});
