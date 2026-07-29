const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

test('applies toc indentation as an important inline margin', () => {
  const declarations = [];
  const rendered = {
    dataset: {},
    style: {
      setProperty(name, value, priority) {
        declarations.push([name, value, priority]);
      },
    },
  };

  Integration.applyImportantMarginLeft(rendered, 4.5);

  assert.equal(rendered.dataset.readerTocIndent, '4.5');
  assert.deepEqual(declarations, [['margin-left', '4.5%', 'important']]);
});

test('falls back to marginLeft for lightweight test DOMs', () => {
  const rendered = { dataset: {}, style: {} };

  Integration.applyImportantMarginLeft(rendered, 3);

  assert.equal(rendered.dataset.readerTocIndent, '3');
  assert.equal(rendered.style.marginLeft, '3%');
});
