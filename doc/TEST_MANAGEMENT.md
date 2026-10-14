# Test management (2.7.0)

This checkout adds execution, evidence, defect relationships, reporting, and case
reuse. Building this checkout does not update another MCP installation automatically.

## Installation

1. Run npm ci, npm run typecheck, npm test, and npm run build.
2. Configure the MCP client to run node with the absolute path to build/index.js.
3. Provide TP_BASE_URL and TP_TOKEN through the existing environment/secrets setup.
   DOTENV_CONFIG_PATH may point to an existing environment file.
4. Reconnect the client, verify get_version, and list the tools.

Never commit credentials or copy a real environment file into this repository.
Builds do not publish packages, push Git changes, or update another installation.

## New tools

| Area | Tools |
|---|---|
| Discovery | get_test_management_metadata, get_test_run_workflow |
| Cases | create_test_case, list_test_cases, clone_test_case, link_test_cases_to_test_plan |
| Maintenance | retry_test_case_steps, reorder_test_steps, reorder_test_cases, update_test_plan, get_test_step_by_id |
| Runs | create_test_plan_run, list_test_plan_runs, get_test_plan_run, get_test_case_run |
| Execution | update_test_case_run, update_test_step_run, batch_update_test_case_runs |
| Lifecycle | update_test_plan_run, complete_test_plan_run, reopen_test_plan_run |
| Evidence | upload_attachment, list_attachments, attach_test_run_evidence |
| Defects | link_bug_to_test_case_run |
| Reporting | get_test_run_summary, get_test_case_history, get_requirement_test_coverage |

Existing case/step editing, deletion, tags, nested-plan, move, and unlink tools
remain available. The existing batch creation tool requires at least one step;
create_test_case additionally supports title-only drafts.

## Create and maintain cases

Example arguments for create_test_case:

~~~json
{
  "name": "Login displays the dashboard",
  "testPlanId": "100001",
  "description": "<p>Precondition: an authorized test account exists.</p>",
  "steps": [
    { "description": "Sign in with the test account.", "result": "The dashboard appears." }
  ]
}
~~~

The destination plan supplies the project. A conflicting projectId is rejected.
Standalone cases accept projectId or TP_PROJECT_ID. Creation verifies the case's
membership, step count, and step order.

Creation returns complete or partial with the created ID and failed step indexes.
Batch creation returns created, partial, failed, and unprocessed.
Use retry_test_case_steps to resume the same case: existing exact matches are
skipped, conflicting positions are rejected. Do not recreate a case because one
step failed.

link_test_cases_to_test_plan preserves existing memberships and validates projects.
clone_test_case copies the case and ordered steps, excluding execution history
and defects. update_test_plan changes a plan's name or description.

reorder_test_steps requires every existing step ID exactly once.
reorder_test_cases defaults to a dry run and requires all direct case IDs.
It only uses NumericPriority when tenant metadata exposes that field. Shared-case
ordering can affect other plans: review sharedCases and explicitly set
acknowledgeSharedOrder before applying. Verify this behavior for your TP version.

## Execute a test cycle

1. Call create_test_plan_run with testPlanId and optional name, description, buildId.
   Put tenant, stage, build/tag, and scope in description when no dedicated
   tenant-specific field has been configured.
2. Read generated case-run IDs with get_test_plan_run. Targetprocess creates
   these records automatically. Nested runs are included.
3. Read a case and its generated step runs with get_test_case_run.
4. Inspect get_test_management_metadata for supported statuses. Passed and Failed
   are documented examples; other spellings vary by tenant/version.
5. Perform the actual test with browser/API testing tools.
6. Upload the observed screenshot and save the actual result.
7. Link any observed defect and review the execution summary.
8. Complete the run using a final state from get_test_run_workflow.

Creation retains the new run ID even when automatic generation or verification
is incomplete. Re-read that run instead of creating another one.

This MCP stores results; it does not interact with the application under test.
Expected-result text is not execution evidence.

## Evidence and results

Example arguments for attach_test_run_evidence:

~~~json
{
  "testCaseRunId": "400001",
  "filePath": "C:\\Users\\Example\\Pictures\\observed-result.png"
}
~~~

Alternatively provide raw base64 fileContent and fileName. Use exactly one file
source. Paths must be absolute on the MCP server host. Uploads are limited to
25 MiB. Generic upload_attachment accepts generalId.

Execution evidence is uploaded to the parent Test Plan Run and referenced in the
specific Test Case Run note. This avoids assuming a TestCaseRun is a General
entity accepted by UploadFile.ashx. Uploaded attachments are read back.

update_test_case_run accepts id, exact tenant-supported status, comment containing
the observed result, and evidenceAttachmentIds. At least one screenshot attached
to the same run is required. Status and note are verified after writing.
Filename/MIME checks identify image attachments; the caller must ensure the image
shows the relevant observation without credentials or unrelated sensitive data.

link_bug_to_test_case_run links an existing bug through the execution relationship,
preserves previous links, and verifies the result. Report real defects only for
observed failures. Clearly label any expressly authorized integration fixture.

## Completion and reporting

get_test_run_workflow derives valid state IDs from the run project's process.
complete_test_plan_run requires a final stateId and checks all nested case runs.
Passed/Failed count as executed. Other statuses require allowIncomplete: true and
a reason, recorded on the run.

Execution tools reject final runs and runs beneath a final parent. Reopening is
explicit; parent runs are never reopened automatically. Targetprocess also
enforces its own restrictions. State writes are read back.

get_test_run_summary includes nested execution counts, outstanding cases, and
linked defects. get_test_case_history returns execution records.
get_requirement_test_coverage reports linked case inventory; counts do not prove
requirement completeness or execution success.

List/history tools accept take (1-100) and skip. Follow pagination when another
page exists. Internal hierarchy and attachment reads paginate fully.

## Reliability

- API failures include operation, HTTP status, and sanitized messages, with
  isError on MCP errors. Secrets and full write payloads are not logged.
- Requests have timeouts; only reads retry transient failures. Writes never retry
  automatically because a timed-out write may already have succeeded.
- TP_REQUEST_TIMEOUT_MS defaults to 30000 (range 1-300000).
- TP_READ_RETRIES defaults to 2 (range 0-5).
- TP_DEBUG=true logs operation/status metadata only.
- Tenant-specific owner/process defaults were removed. Set TP_PROJECT_ID or
  TP_PROCESS_ID for legacy workflow discovery.
- MCP handshake and get_version use the same package version.
- Unsupported permissions, metadata, or nested-run discovery produce explicit
  errors rather than an incomplete success.
- Multi-request operations are not server transactions. Retain partial-result
  IDs and inspect current records before resuming.
- Authenticated users and timestamps come from the API; do not impersonate a tester.

## References

- [Testing API](https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=cases-testing-module)
- [Attachments](https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=crud-upload-attachments)
- [Shared-case ordering](https://www.ibm.com/docs/en/targetprocess/atp/saas?topic=area-test-cases-test-plans-creation)

## Verified tenant compatibility

Live MCP validation on 2026-10-14 confirmed that the validated tenant stores step
execution as writable Passed and Runned booleans rather than a Status property.
The tool maps Passed/Failed accordingly and verifies both fields. Case runs use
Status. Defect collections can have CanSet=false with CanAdd=true: additive links
are permitted even though wholesale collection replacement is read-only.

A smoke test in an isolated child plan verified creation, generated case/step
records, screenshot evidence, case/step results, defect links, summaries, completion,
reopening, and final-state write protection. This is integration validation, not
an ERP release assessment. Local sample IDs/reports remain under ignored validation/.

Execution history uses the case-to-TestCaseRuns relationship rather than assuming
root-collection filtering/sorting support. TestCaseRuns have no CreateDate property;
reports prefer EndRunDate, then legacy RunDate, then StartRunDate from the API.

## Existing connected-server tools preserved

The original checkout was older than the connected 2.6.10 server. The sibling-plan
move and child-plan unlink implementations were retained from that installed
version, with their dry-run defaults and source-restoration/preservation checks:
move_test_cases_between_sibling_plans and unlink_child_test_plan_from_parent.
The build therefore preserves all 87 connected tools and adds 28 new tools.
