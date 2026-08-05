from __future__ import annotations

from pathlib import Path


TEST_API = "https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space"
PRODUCTION_API = "https://carsonhhs-pdf-ocr-service.hf.space"


def main() -> None:
    index = Path("index.html").read_text(encoding="utf-8")
    debug = Path("reader-node-debug.html").read_text(encoding="utf-8")
    runtime = Path("preview-runtime.js").read_text(encoding="utf-8")
    presentation = Path("reader-presentation-source-rendering.js").read_text(
        encoding="utf-8"
    )
    presentation_css = Path("reader-presentation-source-rendering.css").read_text(
        encoding="utf-8"
    )

    preview_position = index.index('<script src="preview-runtime.js"></script>')
    reader_position = index.index('<script src="reader-api.js"></script>')
    bookshelf_position = index.index('<script src="bookshelf.js"></script>')
    assert preview_position < reader_position < bookshelf_position

    debug_preview_position = debug.index('<script src="preview-runtime.js"></script>')
    debug_reader_position = debug.index('<script src="reader-api.js"></script>')
    debug_bootstrap_position = debug.index('<script>ReaderNodeDebugV2.bootstrap();</script>')
    assert debug_preview_position < debug_reader_position < debug_bootstrap_position

    guard_position = runtime.index("if (!PREVIEW_PATH_PATTERN.test(pathname))")
    reader_override_position = runtime.index(
        "root.READER_API_BASE_URL = TEST_API_BASE_URL"
    )
    fetch_override_position = runtime.index(
        "root.fetch = async function previewFetch"
    )
    assert guard_position < reader_override_position < fetch_override_position
    assert "const PREVIEW_PATH_PATTERN" in runtime
    assert "/preview/pr-" in runtime.replace("\\/", "/")
    assert "runtime skipped outside PR preview" in runtime

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

    assert "reader-semantic-page.js" in runtime
    assert "reader-semantic-page-integration.js" in runtime
    assert "reader-presentation-source-rendering.js" in runtime
    assert "reader-presentation-source-rendering.css" in runtime
    assert "installPresentationSourceRendering" in runtime

    assert "presentation_mode === 'source_rendering'" in presentation
    assert "ocr_route === 'skipped_presentation_image'" in presentation
    assert "filteredPlaybackNodes" in presentation
    assert "classificationAudit" in presentation
    assert "reader-v2-page--presentation-source-rendering" in presentation_css
    assert "object-fit: contain" in presentation_css

    print("preview runtime validation passed")


if __name__ == "__main__":
    main()
