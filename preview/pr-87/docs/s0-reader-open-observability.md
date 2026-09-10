# S0.3.5 core Reader open instrumentation

Status (2026-09-02): **Staging core Reader observability PASS for the scopes below. S0 and M5 remain In Progress.** This is not full S0 completion, a new ingestion benchmark, or Production rollout approval.

The companion [Backend contract](https://github.com/CarsonHHS2023/pdf-ocr-service/blob/96801ce840b5dc5d1855e101dbd55df7a592afd8/docs/reviews/s0-3-5-reader-open-observability-contract-2026-09-02.md) is implemented by [Backend #40](https://github.com/CarsonHHS2023/pdf-ocr-service/pull/40), merged and deployed to Staging. Its original acceptance-pending wording is historical; the scoped results below are the frontend evidence update.

## Runtime and measurement contract

Only this branch's PR Preview build inserts `atlas-s0-reader-preview=1`. The runtime additionally requires a PR Preview path, exact frontend revision meta and the fixed Backend Staging origin. Ordinary Preview and Production retain their existing destinations. No Production merge is part of this slice.

The S0 Preview sends both login and application requests to Staging. It stores Staging's token under the separate session key `smart-reading-access-token:s0-staging`; it never reads, migrates or clears the existing Production/shared-Preview token. Ordinary Preview keeps its shared Production login. No cross-environment token-signing-secret equality is assumed, and no backend secret is changed. The access bootstrap is cache-busted with the exact frontend SHA and included in public asset-byte verification. Staging must already have its own access-password hash and signing secret configured; a login `401`/`503` must be diagnosed without falling back to Production authentication or disabling access control.

`ReaderV2Controller.openBook` records core semantic-open time through initial render and synchronous final page notification. Its metadata/navigation/150-node content requests carry random correlation IDs and ordinals; Backend revision headers must agree. The terminal is a detached, non-retrying POST containing only bounded identity/revision, mode, request count and elapsed seconds. It never records titles, filenames, node content, asset URLs or tokens. Existing authentication handles the request.

First open uses one content window; saved node-order reopen uses the target and optional next window. Legacy node-id scans, overlapping/failed opens and empty results remain outside successful telemetry. Binary assets, browser paint, asynchronous enhancement completion and later interactions are excluded. This measures the core open only, not full visible-page readiness or upload-to-reader latency.

Backend SQL counts are independent server measurements. Its existing full-candidate projection is unchanged; bounded HTTP windows do not imply bounded rows. First/reopen measurements are summarized separately and require complete unique durable Backend requests plus a client terminal for the same candidate and revision.

## Accepted observations

The user confirmed Staging login and tested already processed documents. Read-only durable-event exports were joined to the exact selected candidate's succeeded processing run, then checked with the unchanged collector from the exact Backend checkout plus its 15 CI overlays. The PDF collection used the baseline CLI against a local SQLite projection; the TXT collection used `collect_s0_run_snapshot` against an in-memory SQLite projection. Neither was execution inside HF nor replay of a byte-verified downloaded deployment artifact.

| Provenance | Exact revision / verification |
|---|---|
| Frontend used for all listed Reader observations | `af087d078bd03182bc53610e045778a9d733eda5` |
| Backend used for all listed Reader observations | `96801ce840b5dc5d1855e101dbd55df7a592afd8` |
| Backend Staging deployment | [Run 33582952733](https://github.com/CarsonHHS2023/pdf-ocr-service/actions/runs/33582952733), job `100101188850`; exact runtime revision and head guards passed |
| Frontend Client CI | [Run 33628529874](https://github.com/CarsonHHS2023/speed-reading-trainer/actions/runs/33628529874), success at the observed frontend revision |
| Frontend Preview deployment | [Run 33628529951](https://github.com/CarsonHHS2023/speed-reading-trainer/actions/runs/33628529951), job `100241971277`; five-script byte verification and exact-head guards passed |
| Code review / local validation | No new P1/P2 blocker identified in the Codex-style review; 496 tests passed, zero failed/skipped, and `npm run check` passed at the observed frontend revision |

Both `reader_open_latency_seconds` and `reader_bounded_query_count` were **observed** in each collection. Modes and documents remain separate:

| Tested scope | Samples | Client core-open mean (seconds) | SQL statement attempts per open | Content window |
|---|---:|---:|---|---|
| Existing PDF medium, 11 pages / 89 stored nodes: first open | 3 | 5.610667 | 57, 57, 57 | start 0, limit 150 |
| Same PDF medium: saved-position reopen | 1 | 5.2728 | 57 | start 0, limit 150 |
| Existing TXT, 1,013 stored v2 nodes: nonzero saved-position reopen | 1 | 7.1425 | 57 | start 300, limit 150 |

Each observed open made three measured HTTP data requests: metadata, navigation and content. Each request measured 19 SQL statement attempts. The sum of server request durations for the TXT reopen was 6.408282 seconds; it is a separate auxiliary boundary, not the client duration. These are baseline samples, not a performance improvement or latency SLO claim.

The PDF collection retained 16 Reader events (12 requests and four terminals); the TXT collection retained four (three requests and one terminal). Each scope had one terminal and ordinals 1, 2, 3 without duplicates or gaps. Candidate/run/revision associations, event schemas, snapshot bounds and export-digest rechecks passed. No malformed or oversized payloads or privacy-sensitive event fields were found. Maximum Reader payload sizes were 360 bytes and 356 bytes, respectively, below the 8,192-byte bound. Full raw evidence and exact private identities remain in the private acceptance records, not this repository.

## Coverage and remaining boundaries

- The PDF medium establishes first-open and reopen observations inside the first window. It is **not** a one-page small-fixture acceptance.
- The TXT test adds nonzero-window reopen evidence, not TXT ingestion timing or first-open coverage on that TXT run. It is not relabeled as a registered formal small/medium fixture.
- No adjacent second window was measured. The existing `reader-resume-window-policy.js` loads only the containing 150-node window, and is unchanged from frontend base `a3ca1c861a513ec0997eaa89be9419a7659ca68a`. The telemetry contract permits an optional adjacent request; this test neither proves two-window loading nor changes the earlier product requirement by implication.
- Legacy node-ID-only resume, failed/overlapping opens, mixed revisions, binary-asset completion, browser paint, later interactions and pixel-exact restoration are not successful coverage claims here.
- The collector deliberately fails closed on abandoned partial scopes, mixed revisions or more than 32 opens for one processing run. Those scopes are not silently dropped. No upload, reprocessing or evidence deletion is authorized to work around this limit.
- Reader events were appended to existing succeeded ingestion runs. Earlier ingestion, transport and compute measurements were not newly measured on this Reader revision.
- Documentation-only descendants do not change the recorded observation SHAs. CI or Preview success on a later documentation commit is **not** new runtime fixture acceptance. Do not reopen the accepted runs merely to refresh a SHA: a new frontend revision on the same run would mix revisions under the collector's contract.

## Milestone and release boundary

The [milestone index](https://github.com/CarsonHHS2023/pdf-ocr-service/blob/96801ce840b5dc5d1855e101dbd55df7a592afd8/docs/milestones/README.md) and [M5 record](https://github.com/CarsonHHS2023/pdf-ocr-service/blob/96801ce840b5dc5d1855e101dbd55df7a592afd8/docs/milestones/M5.md) were checked: **S0 and M5 remain In Progress**. This evidence update does not close other S0 metrics, representative TXT ingestion or large-PDF baselines, M5 exit criteria, or the final S0 completion review. S1/S2 are not started.

Frontend #86 remains unmerged; merge is a separate user decision. Its base is `main`, whose push workflow publishes the Production Pages root even though S0 telemetry stays gated off there. Therefore code review and scoped Staging acceptance do **not** authorize merging or Production deployment. No new upload, OCR run, 100-page/528-page benchmark, Production change or merge was performed to collect or document these observations.
