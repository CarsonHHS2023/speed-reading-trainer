# Phase 24C.4 Browser Acceptance

Validate against a newly loaded production page after deployment:

1. Right rail shows the document-navigation tab and contains title, metadata, find, and TOC navigation.
2. Legacy left sidebar is hidden after the rail is ready.
3. Single-line OCR TOC content is split into separate dotted-leader/page-number entries.
4. Exact Paddle furniture labels (`number`, `page_number`, `header`, `header_image`, `footer`, `footer_image`, `aside_text`, `footnote`) do not enter playback.
5. Normal body lines are left aligned and use nearly the full playback width; only titles and headings are centered.
6. Standalone punctuation nodes are attached to the preceding text node.
7. A manual figure/table/formula frame is followed by all mapped text content after it.
8. Image preprocessing and show-through suppression are explicitly out of scope for this phase.
