# Manual Workspace Incremental Sync UI Wiring
## Non-binding engineering guide

> This guide is non-binding.
>
> Published baseline:
> `efcc272c2e725b06ce4e2b0192fade84611c1f2e`
>
> Current source and tests remain authoritative.

## Verified gap

`ClientWorkspaceService` already exposes:

```text
drainPendingWorkspace(projectId)
→ POST /api/projects/:projectId/workspace/retry-sync
```

But `WorkspaceEnsurePanel` does not call it.

The current READY-state button uses:

```text
runWorkspaceEnsureJourney(...)
```

and therefore produces:

```text
runtime-version
ensure
workspace
```

instead of:

```text
retry-sync
```

The Arabic label `gws.one.verify = "تحقق ومزامنة Google"` is therefore misleading because that button verifies/ensures the Workspace rather than draining pending incremental projection work.

## Required UI contract

When Workspace status is `READY`:

1. keep the existing verification/ensure action, but rename it so it clearly means verification;
2. expose one separate manual sync action:
   `مزامنة بيانات Google Sheets الآن`;
3. that action calls only:
   `drainPendingWorkspace(projectId)`;
4. one click = one POST `/workspace/retry-sync`;
5. it must not call `/workspace/ensure`;
6. it must not call `/workspace/refresh-reports`;
7. it must not trigger `user-active-sync`;
8. no polling or automatic invocation.

## State

Manual sync should have bounded local state:

```text
IDLE
SYNCING
SUCCESS
FAILURE
```

Prevent duplicate clicks while in flight.

## Semantics

A clean Project is a valid no-op:

```text
retry-sync = 1
Google delivery = 0 when nothing is pending
```

A dirty Project drains only pending incremental work.

Do not perform a full historical Trip scan.

## Localization

Add or reuse clear AR/EN/UR keys for:

```text
Verify Google Workspace
Synchronize Google Sheets data now
Synchronization complete
Synchronization failed
```

Do not reuse ambiguous wording.

## Tests

Prove:

- READY state shows separate Verify and Sync actions;
- Verify action does not call `retry-sync`;
- Sync action calls `retry-sync` exactly once;
- Sync action does not call `ensure`;
- Sync action does not call `refresh-reports`;
- double click while pending does not duplicate;
- success/failure feedback;
- clean Project succeeds as bounded no-op;
- existing ensure journey tests still pass;
- localization parity preserved.

## Do not change

Do not modify:

- incremental sync backend semantics;
- 3-hour scheduler architecture;
- report refresh endpoint;
- Firestore quiescence changes;
- build tooling;
- Phase 10.

## Success state

```text
MANUAL_INCREMENTAL_SYNC_UI = IMPLEMENTED
VERIFY_AND_SYNC_ACTIONS = SEPARATED
RETRY_SYNC_PER_CLICK = 1
AUTO_SYNC = 0
REPORT_REFRESH_COUPLING = 0
PHASE_10 = NOT_STARTED
```
