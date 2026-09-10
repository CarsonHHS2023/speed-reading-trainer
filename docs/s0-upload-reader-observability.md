# S0 upload-to-initial-semantic-render candidate

Status: implementation candidate, 2026-09-10; Staging acceptance pending.

This companion to the Backend upload/Reader v1 protocol measures one canonical
single-PDF upload through its existing automatic initial core semantic render.
It uses one same-page browser clock, exact Preview/Backend revisions, a committed
upload acknowledgement and the exact existing first-open Reader scope.

The endpoint is after nonempty initial content and synchronous final page-change
notification. Binary asset completion, asynchronous annotations/enhancements and
browser paint are excluded. The two terminal POSTs are detached; the existing
Reader event fields and three bounded first-open data requests are unchanged.

The upload handler reads the effective Preview routing override for observation
eligibility; its existing fetch routing and Staging access token remain in use.
The operation token is passed through automatic selection and every Reader
wrapper. Manual opens, batch uploads, overlapping operations, hidden/page-loss
events, replaced clocks, expired intervals and failed/empty rendering cannot
publish a successful upload measurement. Pending batch polls retain only bounded
observation tickets, never source files or upload bodies.

`s0-upload-reader.js` is inert outside the explicitly marked S0 PR Preview and
fixed Staging Backend. It adds no persisted browser clock or remembered last
upload. After reload, a fresh upload is required for this scope.

Backend collection may initially lack a Reader row even after the new terminal
POST succeeds. Acceptance requires a complete durable snapshot for the exact
upload/run/source/candidate/open and both deployed source revisions. Local tests
and Preview publication do not constitute that acceptance.

S0 remains In Progress. This candidate does not close the deployed required
metric, alter Production Pages, request a new fixture or authorize a merge.

## Diagnosing a missing upload terminal

The first deployed upload/Reader attempt retained upload acceptance and a complete
Reader first-open scope, but no upload terminal. The cause is unresolved; a missing
browser resource entry does not prove that a request was never sent. Do not infer
that the page went into the background without evidence.

On this Preview, `AtlasS0UploadReader.observer.diagnostics()` returns a copy of the
latest eligible upload's in-memory diagnostic, capped at 16 steps. It records
acknowledgement validation, lifecycle/association rejection, Reader binding,
terminal dispatch attempts, and response status or fetch rejection. It contains
only the frontend revision, fixed step codes and an optional numeric HTTP status;
no document/root IDs, filenames, URLs, content, headers, tokens or exception text.
It is not written to browser storage or sent to another endpoint. Refresh clears
it. Late responses from a preceding upload cannot replace the current diagnostic.

`terminal_dispatch_attempted` alone does not prove server receipt. An HTTP 204 is
an endpoint response, not collector acceptance: the exact durable evidence still
must be checked. These diagnostics cannot restore a prior upload clock and do not
relax eligibility, retry terminal writes or change the measurement boundary.
