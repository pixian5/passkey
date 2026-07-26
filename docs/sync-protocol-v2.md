# Pass Sync Protocol v2

This is the current V2 wire and merge contract for Tauri, Docker Web, Chrome
Web, compatible legacy clients, and the self-hosted sync server. Platform
capability status is documented separately; compatibility with this protocol
does not imply full UI parity.

## Payloads

- Plain bundle schema: `pass.sync.bundle.v2`.
- Optional encrypted schema: `pass.sync.encrypted.v1`.
- With a non-empty sync key, remote payloads are AES-256-GCM envelopes. With an
  empty sync key, clients send plaintext `pass.sync.bundle.v2` only when the
  server allows plaintext. The server never decrypts business fields.
- The envelope authenticates the schema string `pass.sync.encrypted.v1` as
  additional authenticated data.

## Identity and merge

- Accounts are matched by stable `recordId` first, then historical `accountId`.
- Fields use their own `*UpdatedAtMs` and `*UpdatedDeviceName` values.
- A newer timestamp wins. Equal timestamps use account timestamp, then stable
  device-name ordering, then lexical value ordering.
- Sites, folder IDs, Passkey IDs, and aliases use relation states/tombstones;
  visible arrays are derived and normalized rather than blindly unioned.
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

- Clients create a local safety snapshot before a sync operation replaces the
  local payload. A remote-only write does not require a local replacement snapshot.
- Remote-overwrite-local requires a non-empty primary source.
- Database/key mismatch is fatal: clients must not create a replacement key or
  fall back to a smaller legacy dataset.
- Recovery must preserve `pass.db`, `pass.db-wal`, and `pass.db-shm` together.

## Diagnostics

Sync UI exposes the available local/remote counts, safety reasons and source
completion status. Revision/ETag are protocol diagnostics but are not currently
shown in every surface. Error messages must preserve HTTP status and operation
stage (`pull`, `merge`, `push`, or `restore`) when available.
