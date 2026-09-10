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
