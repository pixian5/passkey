# Pass Sync Protocol v2

This document is the cross-platform contract for the macOS app, browser
extensions, and self-hosted sync server.

## Payloads

- Plain bundle schema: `pass.sync.bundle.v2`.
- Remote production schema: `pass.sync.encrypted.v1`.
- Remote payloads must be AES-256-GCM envelopes. The server stores the envelope
  and never decrypts account, password, TOTP, recovery-code, or Passkey fields.
- The envelope authenticates the schema string `pass.sync.encrypted.v1` as
  additional authenticated data.

## Identity and merge

- Accounts are matched by stable `recordId` first, then historical `accountId`.
- Fields use their own `*UpdatedAtMs` and `*UpdatedDeviceName` values.
- A newer timestamp wins. Equal timestamps use account timestamp, then stable
  device-name ordering, then lexical value ordering.
- Sites, folder IDs, Passkey IDs, and aliases are unioned and normalized.
- Folder and Passkey removals use `isDeleted`, `deletedAtMs`,
  `deletedDeviceName`; permanent tombstones use `isPermanentlyDeleted` and
  remain authoritative until a future protocol-defined garbage-collection
  acknowledgement.
- Permanent-delete tombstones cannot be recreated by stale active records.
- A remote empty payload never replaces a non-empty local payload.
- A merge is rejected if any local stable account, folder, or Passkey ID is
  absent from the merged result.

## Server concurrency

- `GET /v2/sync/state` returns `ETag` and `X-Sync-Revision`.
- `PUT /v2/sync/state` must send `If-Match` when updating an existing state.
- Clients send a unique `Idempotency-Key` for every logical write.
- HTTP `412` means the client must pull, merge, and retry from the new ETag.
- Each successful PUT or restore appends **exactly one** new `payload_versions` row for the new state. Do not re-insert the previous snapshot before the new one.
- `X-Sync-Revision` equals `MAX(version_id)` for the scope; two successful writes produce revisions `1` then `2`.
- Version history retains at most 50 entries per scope.
- Audit history retains at most 5000 entries per scope and never stores ciphertext bodies.
- Rate-limit windows are keyed by client IP and expire after about one minute.

## Safety and recovery

- Clients create a local safety snapshot before every sync write.
- Remote-overwrite-local requires a non-empty primary source.
- Database/key mismatch is fatal: clients must not create a replacement key or
  fall back to a smaller legacy dataset.
- Recovery must preserve `pass.db`, `pass.db-wal`, and `pass.db-shm` together.

## Diagnostics

Every sync UI should expose local/remote counts, conflict count, source name,
remote revision, ETag, and last sync time. Error messages must preserve the
HTTP status and operation stage (`pull`, `merge`, `push`, or `restore`).
