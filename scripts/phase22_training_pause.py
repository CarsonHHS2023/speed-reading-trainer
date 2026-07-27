from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / 'reader-speed-playback-ui.js'
s = p.read_text(encoding='utf-8')
old = """            button.addEventListener('click', (event) => {\n                event.stopPropagation();\n                this.playback.continueManual();\n            });\n"""
new = """            button.addEventListener('click', (event) => {\n                event.stopPropagation();\n                this.continueManual();\n            });\n"""
if old not in s:
    raise SystemExit('manual Continue handler not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
