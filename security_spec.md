# Security Specification: Meridian Telemetry & Operations Platform

## 1. Data Invariants

1. **Identity & Ownership Invariant**: Every document in `/users/{userId}`, `/users/{userId}/private/{docId}`, `/widgets/{widgetId}`, and `/metrics/{metricId}` MUST be owned by the authenticated user (`uid == request.auth.uid` or `ownerId == request.auth.uid`) and require a verified email (`request.auth.token.email_verified == true`).
2. **PII Split Collection Isolation**: User email addresses are strictly isolated in `/users/{userId}/private/{docId}` (`docId == 'info'`) and can only be read or written by the exact owner (`request.auth.uid == userId`).
3. **Relational Sync (Master Gate)**: Creating or updating `/users/{userId}/private/{docId}`, `/widgets/{widgetId}`, or `/metrics/{metricId}` requires the parent `/users/{userId}` profile document to exist (`exists(/databases/$(database)/documents/users/$(request.auth.uid))`).
4. **Strict Schema & Key Allowlisting**: No unexpected ("ghost/shadow") keys are permitted in any collection. Every string field is bounded by `minLength` and `maxLength` matching `firebase-blueprint.json`.
5. **Terminal State Locking**: Once a metric record in `/metrics/{metricId}` transitions to `status == 'archived'`, it reaches a terminal state and cannot be updated further.
6. **Temporal Integrity & Immutability**: `createdAt` must equal `request.time` on creation and remain immutable on update. `updatedAt` must equal `request.time` on both creation and update. `uid` and `ownerId` are strictly immutable across all updates.
7. **Secure List Queries**: All `list` operations on `/widgets` and `/metrics` enforce `resource.data.ownerId == request.auth.uid` without `get()`/`exists()` inside the list rule to prevent O(n) cost attacks.

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on Widget Creation)**: Authenticated as `user_A`, attempting to create `/widgets/w_1` with `ownerId: "user_B"`.
2. **Payload 2 (Shadow Field Injection on User Profile)**: Authenticated as `user_A`, updating `/users/user_A` with an undeclared field `isAdmin: true`.
3. **Payload 3 (Unverified Email Write Attempt)**: Authenticated as `user_A` with `email_verified: false`, attempting to create `/users/user_A`.
4. **Payload 4 (PII Cross-User Read)**: Authenticated as `user_B`, attempting `get` on `/users/user_A/private/info`.
5. **Payload 5 (ID Poisoning Attack)**: Attempting to create a metric document with an invalid ID `/metrics/invalid$id!with*spaces` or > 128 chars.
6. **Payload 6 (Value Poisoning / Oversized String)**: Updating `/widgets/w_1` with a `title` of 5,000 characters (exceeds `maxLength: 80`).
7. **Payload 7 (Orphaned Write without Master User Profile)**: Authenticated as `user_no_profile`, attempting to create `/widgets/w_orphan` when `/users/user_no_profile` does not exist.
8. **Payload 8 (Terminal State Bypass on Archived Metric)**: Attempting to update `value` on `/metrics/m_archived` where existing `status == 'archived'`.
9. **Payload 9 (Immortal Field Mutation)**: Attempting to mutate `createdAt` or `ownerId` during an update to `/metrics/m_1`.
10. **Payload 10 (Forged Client Timestamp)**: Attempting to create `/metrics/m_1` with a past or future `createdAt` not matching `request.time`.
11. **Payload 11 (Unconstrained List Query Scraping)**: Authenticated as `user_A`, attempting `list` on `/metrics` without filtering `where('ownerId', '==', 'user_A')`.
12. **Payload 12 (Invalid Enum / Boundary Violation)**: Creating `/widgets/w_1` with `colSpan: 99` (outside allowed `1..12`) or `widgetType: "malicious_iframe"`.
