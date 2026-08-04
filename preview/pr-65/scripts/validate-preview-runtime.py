from __future__ import annotations

from pathlib import Path


TEST_API = "https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space"
PRODUCTION_API = "https://carsonhhs-pdf-ocr-service.hf.space"


def main() -> None:
    index = Path("index.html").read_text(encoding="utf-8")
    debug = Path("reader-node-debug.html").read_text(encoding="utf-8")
    runtime = Path("preview-runtime.js").read_text(encoding="utf-8")

    preview_position = index.index('<script src="preview-runtime.js"></script>')
    reader_position = index.index('<script src="reader-api.js"></script>')
    bookshelf_position = index.index('<script src="bookshelf.js"></script>')
    assert preview_position < reader_position < bookshelf_position

    debug_preview_position = debug.index('<script src="preview-runtime.js"></script>')
    debug_reader_position = debug.index('<script src="reader-api.js"></script>')
    debug_bootstrap_position = debug.index('<script>ReaderNodeDebugV2.bootstrap();</script>')
    assert debug_preview_position < debug_reader_position < debug_bootstrap_position

    assert TEST_API in runtime
    assert PRODUCTION_API in runtime
    assert "root.READER_API_BASE_URL = TEST_API_BASE_URL" in runtime
    assert "root.API_BASE_URL_OVERRIDE = TEST_API_BASE_URL" in runtime
    assert "root.fetch = async function previewFetch" in runtime
    assert "book-processing-completed" in runtime
    assert "state.finalResult = payload" in runtime
    # JavaScript regex literals escape path separators as `\/`; normalize them
    # before validating that the Reader v2 document endpoint is observed.
    assert "/api/reader/v2/documents/" in runtime.replace("\\/", "/")
    assert "backendBranch: 'deploy/ocrmypdf-test'" in runtime

    print("preview runtime validation passed")


if __name__ == "__main__":
    main()
