# Speed Reading MVP acceptance checklist

Phase 23 validates the core selected-book Speed Reading path after Phases 19–22:

`PDF/TXT → Reader v2 → SpeedReadingAdapter → PlaybackFrames → playback → semantic resume`

## Automated acceptance coverage

### PDF
- Reader v2 `physical_page` source units drive Page-scope grouping.
- Timed text from different original PDF pages is never mixed into one frame.
- Figure/table/formula nodes become standalone manual frames with no duration or autoplay timer.
- Continue leaves a manual frame and resumes deterministic timed playback.
- Seek into a manual frame remains manual and timer-free.
- Resume records use candidate/node/source-unit/source-anchor/frame identity and contain no presentation page identity.
- Candidate mismatch fails closed through the existing Reader v2 resume identity check.

### TXT
- Reader v2 `text_flow` drives deterministic dynamic Page reflow.
- Narrower line/page settings create more reflow pages without changing canonical node identity.
- Chinese, English lexical tokens, numbers, dates, URLs/email-like tokens, punctuation, and whitespace follow the Phase 20 tokenizer rules.
- English lexical tokens such as `state-of-the-art` are not split.
- Speed-only changes preserve frame text, frame IDs, frame ordinals, and semantic identity while changing only duration.

### Training interaction semantics
- Comprehension pause freezes automatic frame advancement while training elapsed time keeps running.
- Manual figure/table/formula inspection also counts toward training elapsed time.
- Explicit training Pause excludes paused wall time from the training clock.
- Existing UI tests cover reading-area click versus playback Pause/Resume behavior, including nested comprehension-pause → training-pause handling.

### Architecture boundaries
- Selected-book Speed Reading does not use Reader v1.
- It does not use `/api/v1/books/{id}/content`, cached blobs, legacy tokenization, or legacy image markers.
- Presentation page IDs, scroll offsets, and token indexes are not canonical resume identity.
- Phase 23 adds no Study Assistant, AI Tutor, RAG, Flashcards, or other Smart Reading feature.

## Manual browser validation still required

Automated tests validate deterministic contracts and state transitions. Before calling the MVP browser-ready, manually verify in Preview Deployment with one representative PDF and one representative TXT:

1. Open each book from the bookshelf and start Speed Reading.
2. Confirm Focus and Page displays are readable at realistic font/width settings.
3. For PDF Page scope, visually confirm the transition between two original PDF pages.
4. Confirm a figure/table/formula visibly stops autoplay and that Continue resumes it.
5. During timed text, click the reading area: the frame must freeze while the displayed training time continues increasing; click again to resume.
6. Use the toolbar Pause: both frame advancement and training time must stop; Resume must restart them according to the current comprehension/manual state.
7. Exercise Previous, Next, Seek, Space, and Esc with keyboard focus visible.
8. Switch books while partway through, reopen the first book, and confirm semantic resume returns to the expected node/frame without autoplay.
9. Resize/change TXT layout settings and confirm reflow changes presentation without losing the semantic reading position.
10. Complete a document and confirm the UI returns to a stable completed/Reader state without legacy content appearing.

Manual browser validation is intentionally separate from canonical Reader correctness: viewport layout, focus visibility, and perceived reading ergonomics cannot be fully established by deterministic Node tests alone.
