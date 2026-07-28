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
- Alias/site normalization runs before the safety gate on local, primary remote,
  and merged candidates. It must never be used to bypass a permanent-delete
  tombstone.
- `pinnedViews` is merged by view-scope key: unique scopes are retained and a
  same-scope conflict is decided by the newer account side.
- Permanent-delete tombstones remain in the payload and identity sets so stale
  clients cannot resurrect data, but they are excluded from user-visible
  counts, previews, export/import summaries, and safety diagnostics.

## Server concurrency

- `GET /v2/sync/state` returns `ETag` and `X-Sync-Revision`.
- `PUT /v2/sync/state` must send `If-Match` when updating an existing state.
- Clients send a unique `Idempotency-Key` for every logical write.
- HTTP `412` and `428` mean the client must pull, merge, and retry from the new
  ETag (or treat a missing precondition as a conflict).
- A successful write response is a receipt. Clients must verify JSON `ok`,
  `committed`, `scope`, `etag`, `payloadSha256`, `revision`, and
  `idempotencyKey`, and compare them with `ETag`, `X-Sync-Scope`,
  `X-Payload-Sha256`, `X-Sync-Revision`, and
  `X-Sync-Idempotency-Key` headers.
- `POST /v2/sync/versions/{id}/restore` requires both `If-Match` and
  `Idempotency-Key`; retries replay the original restore receipt instead of
  creating another history version.
- Each successful PUT or restore appends **exactly one** new `payload_versions` row for the new state. Do not re-insert the previous snapshot before the new one.
- `X-Sync-Revision` is a scope-local monotonic counter. `version_id` remains a
  global history row identifier, while two successful writes in one scope
  produce revisions `1` then `2` even when another scope is written between them.
- On startup, the self-hosted server migrates old SQLite databases by adding
  `scope_revision` to `payload_versions`, `sync_idempotency`, and `payloads` when
  absent. Historical versions are checked per scope in `version_id` order; a
  fully valid scope keeps its positive revisions, while a scope with any missing
  or invalid value is rebuilt from `1`. Current payload and idempotency rows are
  backfilled by matching `scope + etag`. Missing matches remain `0` and do not
  create a history row.
- The revision migration does not rewrite payload JSON, create tokens or keys,
  or merge scopes. A separate existing compatibility cleanup may move
  unsupported legacy payload rows to a temporary `.jsonl` file and remove them
  from the active table. Back up the SQLite file before upgrading and never let
  old and new server processes write the same database concurrently.
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

### Trace and retry contract (1.3.5)

- Structured sync reports carry a report version, safety result, source, stage,
  retryability, `syncSessionId`, `operationId`, error code, revision and the
  legacy `safe`/`applied`/`pushed` fields for older UI consumers.
- A retry outbox stores the canonical payload SHA-256, expected ETag/revision,
  idempotency key, session and operation IDs. The same target plus the same
  payload hash is one logical write and must reuse those IDs after restart.
  A changed hash is a new logical write: it resets retry attempts and receives
  new IDs, preventing an idempotency key from being reused for different data.
- Self-hosted writes may include `X-Sync-Session-Id`, `X-Sync-Operation-Id`,
  `X-Sync-Client-Device-Id`, and `X-Sync-Client-Version`. The server accepts
  these optional headers, records them in bounded audit history, and never
  treats them as authentication or secret material. Older clients and old
  SQLite audit rows remain valid with null trace fields.
