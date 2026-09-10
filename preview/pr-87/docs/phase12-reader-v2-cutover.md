# M5 Phase 12 — clean Reader v2 selected-book cutover

The bookshelf selected-book path is now Reader v2-native.

```text
BookShelf.selectBook(bookId)
  -> normalized Book metadata
  -> ReaderUIV2.openBook(book)
  -> Reader v2 presentation / Speed Reading v2
```

The selected-book path no longer loads `/api/v1/books/{id}/content`, writes legacy content blobs/tokens/pages/image-marker state, or relies on runtime `BookShelf.prototype.selectBook` replacement.

Book management remains intentionally separate for this phase: `/api/v1/books` list/upload/status/delete endpoints are retained.

Deleting the currently open book stops Reader v2 playback and clears the active Reader v2 session/surface.
