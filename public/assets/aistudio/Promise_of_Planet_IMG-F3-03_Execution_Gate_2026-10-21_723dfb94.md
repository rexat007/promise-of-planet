# Promise of Planet — IMG-F3-03 Execution Gate

**Status:** Design audit completed; implementation **not yet authorized**.  
**Basis:** Google AI Studio read-only report of 2026-10-21.  
**Source of truth:** Studio local workspace for unpushed changes; GitHub for pushed commits only.

## Accepted owner policies

- `Revoked → Approved`: permitted only with a new documented review request, new evidence, and fresh authorized human review.
- Self-approval: permitted only when the verified reviewer is `Owner`; forbidden for all other roles.
- `Rejected → Approved`: permitted following a new documented review request and evidence.
- No automatic AI approvals, publication, Push, or Deploy.

## Grounded architectural findings

- Existing `ManageRights` permission applies to `Owner` and `RightsReviewer`, subject to active verified admin identity.
- The image asset repository uses an isolated versioned envelope, with revision/CAS and a generic editorial update boundary that cannot change rights.
- Its Firestore transaction port supports reads and writes across collections; an independent rights-specific atomic transaction boundary is possible without modifying the accepted generic repository.
- No image rights approval service, durable audit pipeline, or production upload/public delivery is currently verified as implemented.

## Required design corrections before implementation

1. **Status vocabulary:** only `PendingReview`, `Approved`, `Rejected`, and `Revoked`. The audit proposal's `Unverified` transitions must be removed, not silently added to the accepted contract.
2. **Audit identity:** use a dedicated `EditorialImageAsset` target. Do not disguise image audit records as `News`; if using a specialized event format rather than the canonical `AuditEvent` union, define and test its boundary explicitly and do not claim direct type compatibility.
3. **Evidence provenance:** a new evidence reference is a structural condition, not proof of the underlying document's truth. Require a server-persisted, single-use request with server-assigned timestamp, record linkage, revision linkage, and a genuinely new reference relative to the prior decision. True evidence existence and authenticity need a later trusted evidence boundary.
4. **Consistency:** asset revision change, audit append, and review-request consumption must succeed or fail atomically. Avoid an unrestricted record-replacement method on the generic repository.
5. **Clock:** enforce `createdAtIso <= reviewedAtIso <= updatedAtIso` using server-derived time, and reject an apparent clock rollback versus the stored updated/reviewed timestamps.
6. **Safety:** no live callable registration, Storage ingestion, V2 News activation, Firebase Rules change, Push, or Deploy.

## Proposed medium-sized implementation boundary

Create-only, after verified local preflight and review of target absence:

- `functions/src/news/editorialImageRightsReviewService.ts`
- `src/services/editorialImageRightsReviewService.test.ts`

The implementation may contain the specialized review request, human authorization service, in-memory atomic runner and Firestore transaction runner, and domain-specific audit record. If this becomes unmanageably large, report the exact blocker rather than silently expanding the file allowlist.

## Tests required

Authentication/active admin/ManageRights, Owner-only self-approval, distinct reviewer allowed, exact four-state transition graph, Rejected/Revoked reapproval with new persisted single-use request and new references, stale revision conflict, replay rejection, audit append failure rollback, request-consumption rollback, no input identity spoofing, timestamp chronology, no production wiring.

## Known environment limitation

Root TypeScript 6 vs Functions toolchain TypeScript 5.x and absent local `functions/node_modules`; isolated typecheck is useful but full Functions build is not verified. Do not suppress TS5107 by unapproved changes.

## Acceptance sequence

Local preflight → bounded execution → isolated tests/typecheck → code review → owner acceptance → GitHub Sync review → **separate** user-authorized Push/Deploy, if applicable.
