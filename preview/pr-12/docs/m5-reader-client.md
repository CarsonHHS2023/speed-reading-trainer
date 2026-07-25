# M5 Reader Client Integration

This repository consumes the additive Reader contract exposed by `CarsonHHS2023/pdf-ocr-service` under `/api/reader/v1`.

## Opt-in

The structured Reader is intentionally additive during M5 migration. Enable it with the `Reader β` button or the `?reader_v1=1` query parameter. The preference is stored locally as `m5.reader.v1.enabled`.

PDF books use the structured Reader only when opt-in is enabled. TXT remains on the legacy compatibility path until it reaches the same selected Structured Content path or an explicit backend adapter. When structured Reader open fails, the client displays a compatibility notice and falls back to the existing legacy book-content endpoint; this is compatibility behavior, not canonical content fallback inside the Reader contract.

## Contract assumptions

- Reader application contract version: `1`.
- Every content, asset, and table request remains bound to the selected `candidate_id`.
- Content is loaded in bounded page chunks and can be incrementally extended.
- Assets and structured tables are lazy-loaded.
- Recovery/content states are displayed separately from processing state.
- Stale or changed candidate identity fails closed in the Reader client.
- Provider JSON, legacy image markers, local paths, and backend ORM/domain objects are not Reader client canonical state.

## Slice 5 scope

Implemented here:

- Reader open/metadata/navigation integration.
- Ordered page/node rendering for headings and readable text.
- Candidate-bound `ReaderLocation` page/heading navigation.
- Incremental bounded page delivery.
- Recovery/loading/error presentation.
- Lazy image metadata/content and bounded structured-table delivery.
- Keyboard page navigation with `Alt+Left` / `Alt+Right`, semantic headings, visible focus, live status, and text labels for degraded states.
- Zero-dependency Node contract/view-model tests plus a required Reader Client CI workflow.

Deferred to later M5 slices:

- Contract-versioned deterministic Speed Reading segments and controls.
- Lexical find.
- Reopen/local position and stale-location revisit UX beyond the current active session.
- Legacy cutover/deletion or destructive migration.

## Local checks

```bash
npm run check
npm test
```
