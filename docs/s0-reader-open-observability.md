# S0.3.5 core Reader open instrumentation

Implementation under review; Staging acceptance pending. S0 and M5 remain In Progress.

The companion Backend contract is `docs/reviews/s0-3-5-reader-open-observability-contract-2026-09-02.md` in `CarsonHHS2023/pdf-ocr-service`, branch `s0-reader-open-observability`.

Only this branch's PR Preview build inserts `atlas-s0-reader-preview=1`. The runtime additionally requires a PR Preview path, exact frontend revision meta and the fixed Backend Staging origin. Ordinary Preview and Production retain their existing destinations. No Production merge is part of this slice.

`ReaderV2Controller.openBook` records core semantic-open time through initial render and synchronous final page notification. Its metadata/navigation/150-node content requests carry random correlation IDs and ordinals; Backend revision headers must agree. The terminal is a detached, non-retrying POST containing only bounded identity/revision, mode, request count and elapsed seconds. It never records titles, filenames, node content, asset URLs or tokens. Existing authentication handles the request.

First open uses one content window; saved node-order reopen uses the target and optional next window. Legacy node-id scans, overlapping/failed opens and empty results remain outside successful telemetry. Binary assets, browser paint, asynchronous enhancement completion and later interactions are excluded. This measures the core open only, not full visible-page readiness or upload-to-reader latency.

Backend SQL counts are independent server measurements. Its existing full-candidate projection is unchanged; bounded HTTP windows do not imply bounded rows. First/reopen measurements are summarized separately and require complete unique durable Backend requests plus a client terminal for the same candidate and revision.

Acceptance waits for explicit Backend merge and exact Staging deployment. Then use the exact Preview to open and reopen an already processed fixture with valid candidate/run provenance. No upload, benchmark, Production rollout or merge is triggered by these tests.
