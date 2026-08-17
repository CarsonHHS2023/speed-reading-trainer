const test = require('node:test');
const assert = require('node:assert/strict');

const Layout = require('../speed-reading-responsive-layout.js');

function viewFor(styles = new Map()) {
  return {
    getComputedStyle(element) {
      const style = styles.get(element) || {};
      return {
        paddingLeft: style.paddingLeft || '0px',
        paddingRight: style.paddingRight || '0px',
        paddingTop: style.paddingTop || '0px',
        paddingBottom: style.paddingBottom || '0px',
        getPropertyValue(name) {
          return style[name] || '';
        },
      };
    },
  };
}

test('visible playback surface uses its own content box directly', () => {
  const surface = { clientWidth: 1177 };
  const panel = { clientWidth: 1400, dataset: {} };
  const styles = new Map([[surface, { paddingLeft: '6px', paddingRight: '6px' }]]);
  const documentObject = { querySelector() { return null; } };

  assert.equal(
    Layout.playbackSurfaceContentWidth(surface, panel, documentObject, viewFor(styles)),
    1165,
  );
});

test('hidden playback surface reserves the live study-tools rail before frame construction', () => {
  const surface = { clientWidth: 0 };
  const panel = { clientWidth: 1211, dataset: {} };
  const rail = {
    clientWidth: 46,
    getBoundingClientRect() { return { width: 46 }; },
  };
  const styles = new Map([
    [surface, { paddingLeft: '6px', paddingRight: '6px' }],
    [panel, {}],
  ]);
  const documentObject = {
    querySelector(selector) {
      return selector === '.reader-study-tools-rail' ? rail : null;
    },
  };

  const available = Layout.playbackSurfaceContentWidth(surface, panel, documentObject, viewFor(styles));
  assert.equal(available, 1153);
  assert.equal(Layout.targetWidthPx(available, 100, Layout.DEFAULT_SAFE_GUTTER_PX), 1105);
});

test('hidden playback surface falls back to the rail CSS variable before the rail DOM is mounted', () => {
  const surface = { clientWidth: 0 };
  const panel = { clientWidth: 1211, dataset: {} };
  const styles = new Map([
    [surface, { paddingLeft: '6px', paddingRight: '6px' }],
    [panel, { '--study-tools-rail-width': '46px' }],
  ]);
  const documentObject = { querySelector() { return null; } };

  assert.equal(
    Layout.playbackSurfaceContentWidth(surface, panel, documentObject, viewFor(styles)),
    1153,
  );
});

test('hidden playback surface height removes its vertical padding instead of using the full panel height', () => {
  const surface = { clientHeight: 0 };
  const panel = { clientHeight: 600 };
  const styles = new Map([
    [surface, { paddingTop: '52px', paddingBottom: '8px' }],
    [panel, {}],
  ]);

  assert.equal(Layout.playbackSurfaceContentHeight(surface, panel, viewFor(styles)), 540);
  assert.equal(Layout.pageLineCapacity(540, 40, Layout.DEFAULT_SAFE_VERTICAL_GUTTER_PX), 11);
});
