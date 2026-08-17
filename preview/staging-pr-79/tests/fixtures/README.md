# Speed Reading MVP acceptance fixtures

These fixtures are deterministic Reader v2 projections used only by Phase 23 acceptance tests.

- `pdfDocument` / `pdfNodes` represent two ordered `physical_page` source units with timed text plus figure/formula manual nodes.
- `txtDocument` / `txtNodes` represent one `text_flow` source unit with Chinese, English, hyphenated words, numbers, email/date/time content, and punctuation.

They intentionally model Reader v2 semantic/source identity rather than presentation pages, scroll offsets, or legacy token positions.
