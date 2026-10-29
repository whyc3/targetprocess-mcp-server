# MCP 2.8.0 delivery

Scope: this MCP server, its tests, and documentation. Existing local evidence/Final Result changes were preserved and incorporated. No live mutation/deletion tests or release publication were performed.

## Checklist

| # | Result |
|---|---|
| 1 | Historical EntityState transitions with actual predecessor, actor, project/team, UTC time, date/entity/project/type filters, chronological paging. Tenant-exposed TeamState transitions are a separate scope. |
| 2 | Historical tag capability discovery and snapshot comparison where supported. **Unavailable on the verified tenant**: history metadata has no Tags/IsChangedTags. The tool explicitly reports incomplete coverage; it cannot establish the requested Done + Discarded correlation. |
| 3 | Actual Assignments.GeneralUser and Role, tester/role filtering; ownership remains separate. |
| 4 | Separate Iteration and TeamIteration IDs/names/dates/team in get_card_details and search results; iteration/team filters. |
| 5 | RoleEfforts and AssignedEfforts, explicit units/role/field identity; selectable Effort or InitialEstimate. Unset, unavailable and zero remain distinct. Totals group tester/sprint/units; shared role estimates remain unallocated. |
| 6 | Full user/project/process paging follows server Next links. Discovery returns completeness and rejects transport/permission/parsing failures. Fixed API v1 process response casing. |
| 7 | Explicit-ID comment edit/delete with owner validation, format-aware readback and deletion verification. Existing create/read tools preserved. Locally mocked only. |
| 8 | Metadata-driven owner discovery, local/base64 create, metadata/binary read, allowed-root download, metadata update, explicit replacement and verified deletion. Durable upload reservations prevent blind retries. |
| 9 | Bounded image metadata/previews/local OCR; selected PDF pages/text/scanned-page OCR; DOCX paragraphs/tables; XLSX sheets/ranges/cached values; CSV/TSV/JSON/log/text extraction. |
| 10 | TestCaseRun evidence stays on its TestPlanRun and in the exact Final Result. Explicit replacement/removal preserves unrelated case results and checks shared references. Existing result/evidence behavior retained. |
| 11 | Project/process-aware legacy workflow discovery plus exact-card workflow discovery. Card state writes reject IDs outside the target workflow. |
| 12 | Fixed API v1 run ordering: orderByDesc=CreateDate, rather than orderby='CreateDate desc'. Plan/project/latest filters and paging retained. |
| 13 | DOM-based, single-decode HTML equivalence accepts entity encoding without ignoring structure, links, whitespace or real text changes. Write/readback failures retain the run ID and distinct acknowledged/unknown write status. |
| 14 | Linked-card reference payloads contain no Name. Creation verifies the plan/link and unchanged source identity/title; partial verification retains the created plan ID. |

## New tools and example arguments

IDs below are illustrative. Resolve actual tenant IDs before mutations. No examples authorize live writes.

| Tool | Example arguments |
|---|---|
| discover_directory | `{"resource":"Users","keyword":"tester name","all":true}` |
| get_card_details | `{"entityType":"UserStories","id":"12345"}` |
| get_card_workflow | `{"entityType":"Bugs","id":"12345"}` |
| get_qa_workload | `{"entityTypes":["UserStories","Bugs"],"roleId":"9","testerId":"42","teamIterationId":"300","estimateField":"Effort"}` |
| get_history_records | `{"entityType":"UserStory","from":"2026-10-26T00:00:00Z","to":"2026-10-27T00:00:00Z","take":10}` |
| get_status_history | `{"entityTypes":["Bug"],"from":"2026-10-29T09:00:00Z","to":"2026-10-29T11:00:00Z","statusScope":"EntityState","direction":"asc","take":50,"skip":0}` |
| get_tag_history | `{"entityTypes":["UserStory"],"from":"2026-10-26T00:00:00Z","to":"2026-10-27T00:00:00Z"}` |
| update_comment | `{"id":"100","entityId":"12345","description":"<p>Explicitly authorized replacement</p>"}` |
| delete_comment | `{"id":"100","entityId":"12345"}` |
| get_attachment_capabilities | `{"entityType":"TestPlanRuns"}` |
| create_attachment | `{"entityType":"Bugs","entityId":"12345","fileContent":"YWJj","fileName":"report.txt","operationId":"unique-operation-1"}` |
| list_entity_attachments | `{"entityType":"Bugs","entityId":"12345","take":50,"skip":0}` |
| get_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","includeContent":true,"maxContentBytes":1048576}` |
| download_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","destination":"C:/QA/downloads/report.txt"}` |
| update_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","name":"renamed.txt"}` |
| replace_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","fileContent":"eHl6","fileName":"replacement.txt","operationId":"unique-operation-2","removeOriginal":false}` |
| delete_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","acknowledgeUnknownReferences":true}` |
| update_test_run_evidence | `{"testCaseRunId":"400","attachmentId":"100","replacementAttachmentId":"101","removeBackingFile":false}` |
| process_attachment | `{"entityType":"Bugs","entityId":"12345","id":"100","pages":[1,3],"maxChars":12000}`; for XLSX use `sheet` and `range:"A1:H50"`; for text/CSV use `startLine`/`maxRows`. |

Changed tools: get_users/get_projects/get_processes now retrieve complete collections and provide structured completeness; get_bug_workflows/get_user_story_workflows accept projectId/processId; search_tp_cards adds teamId/iterationId/teamIterationId/testerId/roleId and richer results; get_test_management_metadata includes history/assignment/directory resources; list_test_plan_runs adds orderBy/orderDirection; update_test_plan_run and create_test_plan verify safely; upload_attachment/attach_test_run_evidence add operationId and durable recovery. list_attachments preserves its legacy array response; list_entity_attachments supplies explicit paging/completeness.

For stories moved to Done today, use get_status_history with entityTypes=["UserStory"], stateName="Done", and explicit UTC range boundaries. Use statusScope="TeamState" separately when needed. Inputs use a half-open range [from,to). History can coalesce non-state updates within five minutes; identical timestamps do not prove simultaneous actions.

## Attachment guarantees and limits

- Upload/retrieval/processing limit: 25 MiB. ZIP documents: 50 MiB total expanded entries, 20 MiB per entry. PDF: up to 10 selected pages; default first 5. Extraction text: at most 50,000 characters plus bounded structure. XLSX: at most 2,000 cells per selected range. No macros, formulas, or embedded scripts execute. XML entity declarations are rejected.
- Binary authentication requires configured Basic authentication or a session cookie. The documented attachment endpoint does not accept the REST token. Authentication stays in headers; output URLs omit secret parameters. Binary reads and live upload hash verification were locally mocked because this separate authentication was not configured.
- Metadata is discovered per entity type; upload requires independently verifying a General-backed owner. Message-backed files can be read/updated/deleted where exposed, but creation is not advertised as supported by the existing General-only uploader. TestCaseRun direct attachments remain unsupported on this tenant.
- Binary replacement creates a new attachment. The original is retained by default. Upload and metadata/hash verification precede any requested removal. Both IDs and partial recovery information are returned. SHA-256 is verified remotely when binary authentication is available; otherwise output explicitly says metadata verification only.
- Reuse operationId after any timeout or partial failure. Reservations survive server restarts. Reusing an ID for different bytes/owner/name is rejected. An unresolved reservation never automatically uploads again. Inspect candidate IDs before deliberately starting a new operation. Legacy upload/evidence tools derive a content-based ID when none is supplied; supply a fresh ID only for an intentional additional upload.
- Shared TestCaseRun references in the run hierarchy block backing-file deletion. There is no universal API reverse-reference index for arbitrary rich-text links. Non-run deletion requires acknowledgeUnknownReferences; it is always one explicit attachment, never bulk cleanup.
- OCR requires local trained language data and reports confidence/uncertainty. Unsupported, malformed, encrypted/password-required files return explicit results. Legacy DOC/XLS, archives and executable files are unsupported. XLSX dates remain cached Excel serial values with style IDs; no guessed date conversion is applied.

## Dependencies and configuration

Requires Node >=22.13.0 (PDF.js 6 requirement). New runtime dependencies: @napi-rs/canvas, csv-parse, fflate, pdfjs-dist, sharp, tesseract.js. Zod was upgraded to 4.6.7; compatible security updates were applied to the lockfile. One low-severity esbuild development-server advisory remains; this MCP does not run an esbuild development server.

Optional environment settings are in .env.example:

| Setting | Meaning |
|---|---|
| TP_ATTACHMENT_BASIC_AUTH | Base64 encoding of an authorized user:password pair for binary downloads. Keep it secret. |
| TP_ATTACHMENT_COOKIE | Alternative authenticated session cookie; Basic authentication takes precedence. Keep it secret. |
| TP_ATTACHMENT_DOWNLOAD_ROOTS | Existing absolute allowed download directories, separated by `;` on Windows or `:` on Unix. Destinations must be explicit and cannot overwrite files. |
| TP_ATTACHMENT_JOURNAL_DIR | Persistent operation journal directory. Default: the host user's temporary directory/tp-mcp-attachment-operations. Keep this directory across restarts for recovery. |
| TP_HISTORY_TIMEZONE_OFFSET | Verified offset such as +01:00, only needed if an API date has no timezone. Microsoft JSON dates already carry an epoch and normalize directly to UTC. |
| TP_OCR_LANG_PATH | Existing local directory containing eng.traineddata or eng.traineddata.gz. No automatic language-data download. |
| TP_OCR_LANGUAGE | Local trained language name; default eng. |

## Verification and reconnect

Local tests cover pagination/loops/permission errors, actual history predecessors and missing tag support, role estimate semantics, cross-project/team workflow safety, attachment CRUD/recovery/download constraints/shared evidence, parsers/PDF rendering, HTML equivalence, plan reference safety, and MCP initialization/tool discovery. Existing test-management regression suites remain enabled.

Read-only verification on the configured tenant on 2026-10-29 confirmed complete directory discovery, run listing for plan 370981 with take=1, workflow discovery, card detail/assignment metadata, and actual state-history retrieval. Tag history absence was verified from tenant metadata. Mutations/deletions were exercised only with mocks/isolated files. Protocol smoke testing checks the package version and 134 unique tool names. Final automated validation passed 376 tests across 39 files, TypeScript, and the build. Private tenant details remain in the ignored local validation summary.

PowerShell rebuild:

```powershell
Set-Location 'C:\Users\Latifa\Documents\targetprocess-mcp-server'
npm ci
npm run typecheck
npm test
npm run build
```

Restart/reconnect the existing `targetprocess` MCP connection so its Node process loads `C:/Users/Latifa/Documents/targetprocess-mcp-server/build/index.js`. Keep its existing DOTENV_CONFIG_PATH and credential configuration. Verify get_version returns 2.8.0, then list tools and call list_test_plan_runs with `{"testPlanId":"370981","take":1}`. No release or package publication is required.

Optional read-only verification through the rebuilt MCP, with the existing authorized tenant environment configured:

```powershell
$env:TP_VERIFY_READONLY = 'true'
$env:TP_VERIFY_TEST_PLAN_ID = '370981'
npm run verify:readonly
```

This script invokes only named read-only tools and saves a local summary under ignored validation/read-only-check.json. It performs no uploads, comments, updates, or deletions.

Sources: [IBM historical records](https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=record-overview-historical), [full history](https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=record-full-history), [history query examples](https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=record-examples), [attachments API and binary authentication](https://www.ibm.com/docs/en/targetprocess/atp/saas?topic=api-work-attachments-using-apis), plus live tenant metadata. Tenant metadata takes precedence where it exposes TeamState history beyond the documented overview.
