from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ui = ROOT / 'reader-speed-playback-ui.js'
text = ui.read_text(encoding='utf-8')
old = """            for (const id of ['focusModeDisplay', 'pageModeDisplay']) {\n                this.element(id)?.addEventListener('click', (event) => {\n                    if (!this.isReaderActive() || !['playing', 'paused'].includes(this.playback.state)) return;\n                    event.preventDefault();\n                    event.stopImmediatePropagation();\n                    this.togglePause();\n                }, true);\n            }\n\n"""
if old not in text:
    raise SystemExit('reading-surface click toggle block not found')
text = text.replace(old, '', 1)
ui.write_text(text, encoding='utf-8')

css = ROOT / 'speed-reading-v2.css'
text = css.read_text(encoding='utf-8')
old = """#focusModeDisplay.active,\n#pageModeDisplay.active {\n    cursor: pointer;\n}\n\n"""
if old not in text:
    raise SystemExit('active reading-surface pointer style not found')
text = text.replace(old, '', 1)
css.write_text(text, encoding='utf-8')

test_file = ROOT / 'tests' / 'reader-speed-playback-ui.test.js'
text = test_file.read_text(encoding='utf-8')
start = text.index("test('clicking the active reading surface toggles timed playback pause and resume but never advances manual content'")
end = text.index("test('manual UX and new playback bridge contain no legacy content/blob/tokenizer/image-marker dependencies'", start)
replacement = """test('reading-surface clicks do not pause playback; explicit playback controls own timing changes', () => {\n    const documentObject = fakeDocument();\n    const reader = fakeReader();\n    const playback = fakePlayback();\n    playback.frames = [{ frame_id: 'f1', kind: 'timed_text', identity: { node_id: 'n1' } }];\n    const controller = new ReaderSpeedPlaybackUIController({\n        documentObject,\n        readerController: reader,\n        playback,\n        adapter: { buildPlaybackFrames: () => ({ frames: playback.frames }) },\n    });\n    controller.bind();\n\n    const focusSurface = documentObject.elements.get('focusModeDisplay');\n    const pageSurface = documentObject.elements.get('pageModeDisplay');\n    assert.equal(focusSurface.listeners.some((listener) => listener.type === 'click'), false);\n    assert.equal(pageSurface.listeners.some((listener) => listener.type === 'click'), false);\n\n    playback.state = 'playing';\n    const pauseButton = documentObject.elements.get('speedReadingPause');\n    const pauseClick = pauseButton.listeners.find((listener) => listener.type === 'click').callback;\n    pauseClick();\n    assert.equal(playback.pauseCalls, 1);\n    assert.equal(playback.state, 'paused');\n\n    pauseClick();\n    assert.equal(playback.resumeCalls, 1);\n    assert.equal(playback.state, 'playing');\n});\n\n"""
text = text[:start] + replacement + text[end:]
text = text.replace("    assert.match(source, /\\['playing', 'paused'\\]\\.includes\\(this\\.playback\\.state\\)/);\n", "    assert.doesNotMatch(source, /focusModeDisplay', 'pageModeDisplay/);\n", 1)
text = text.replace("    assert.match(css, /#focusModeDisplay\\.active/);\n", "    assert.doesNotMatch(css, /#focusModeDisplay\\.active,[\\s\\S]*cursor:\\s*pointer/);\n", 1)
test_file.write_text(text, encoding='utf-8')
