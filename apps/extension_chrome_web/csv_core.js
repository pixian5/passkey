/**
 * Shared CSV helpers for Pass surfaces.
 * Keep escape/build semantics aligned with core/pass_core/crates/csvio.
 */

export const MACOS_EXPORT_HEADERS = [
  "account_id",
  "sites",
  "username",
  "password",
  "totp_secret",
  "recovery_codes",
  "note",
  "username_updated_at_ms",
  "password_updated_at_ms",
  "totp_updated_at_ms",
  "recovery_codes_updated_at_ms",
  "note_updated_at_ms",
  "is_deleted",
  "deleted_at_ms",
  "last_operated_device_name",
  "created_at_ms",
  "updated_at_ms",
];

export const BROWSER_EXPORT_HEADERS = ["name", "username", "password", "url", "note"];

export function encodeSites(sites) {
  return (Array.isArray(sites) ? sites : []).map((s) => String(s || "").trim()).filter(Boolean).join(";");
}

export function decodeSites(raw) {
  const values = String(raw || "")
    .split(";")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(values)].sort();
}

/** Escape a CSV cell like pass_csvio::escape_csv_cell. */
export function escapeCsvCell(value) {
  let sanitized = String(value ?? "").replaceAll("\r", " ").replaceAll("\n", " ");
  if (/^[=+\-@\t]/.test(sanitized)) sanitized = `'${sanitized}`;
  return `"${sanitized.replaceAll('"', '""')}"`;
}

/** Build CSV document; headers stay bare, body cells escaped. */
export function buildCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
  }
  return lines.join("\n");
}

/** Parse one CSV line with quotes/escapes. */
export function parseCsvLine(line) {
  const out = [];
  let cell = "";
  let quoted = false;
  const text = String(line ?? "");
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  out.push(cell);
  return out;
}

export function parseCsv(text) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n").filter((line, index, arr) => !(index === arr.length - 1 && line === ""));
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).filter((line) => line.trim().length).map(parseCsvLine);
  return { headers, rows };
}

function headerIndex(headers, names) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Map browser/password-manager CSV rows into account drafts.
 * Supports common Chrome/Firefox/Safari/1Password-ish headers.
 */
export function browserCsvToAccountDrafts(csvText) {
  const { headers, rows } = parseCsv(csvText);
  if (!headers.length) return [];
  const siteIndex = headerIndex(headers, ["url", "website", "login_uri", "hostname", "name", "sites"]);
  const userIndex = headerIndex(headers, ["username", "login_username", "user", "login"]);
  const passIndex = headerIndex(headers, ["password", "login_password"]);
  const noteIndex = headerIndex(headers, ["note", "notes", "extra", "comments"]);
  const totpIndex = headerIndex(headers, ["totp", "totp_secret", "otpauth", "otp"]);
  const drafts = [];
  for (const row of rows) {
    let site = siteIndex >= 0 ? String(row[siteIndex] || "").trim() : "";
    if (!site) continue;
    // strip scheme for storage sites
    try {
      if (/^https?:\/\//i.test(site)) {
        const url = new URL(site);
        site = url.hostname || site;
      }
    } catch (_) {}
    site = site.replace(/^www\./i, "");
    drafts.push({
      sites: decodeSites(site),
      username: userIndex >= 0 ? String(row[userIndex] || "") : "",
      password: passIndex >= 0 ? String(row[passIndex] || "") : "",
      note: noteIndex >= 0 ? String(row[noteIndex] || "") : "",
      totpSecret: totpIndex >= 0 ? String(row[totpIndex] || "") : "",
    });
  }
  return drafts;
}

export function accountsToBrowserCsv(accounts) {
  const rows = (accounts || []).map((account) => [
    account.canonicalSite || (account.sites && account.sites[0]) || "",
    account.username || "",
    account.password || "",
    (account.sites && account.sites[0]) || account.canonicalSite || "",
    account.note || "",
  ]);
  return buildCsv(BROWSER_EXPORT_HEADERS, rows);
}

export function accountsToMacosCsv(accounts) {
  const rows = (accounts || []).map((account) => [
    account.recordId || account.accountId || account.id || "",
    encodeSites(account.sites || []),
    account.username || "",
    account.password || "",
    account.totpSecret || "",
    account.recoveryCodes || "",
    account.note || "",
    String(account.usernameUpdatedAtMs || account.updatedAtMs || 0),
    String(account.passwordUpdatedAtMs || account.updatedAtMs || 0),
    String(account.totpUpdatedAtMs || account.updatedAtMs || 0),
    String(account.recoveryCodesUpdatedAtMs || account.updatedAtMs || 0),
    String(account.noteUpdatedAtMs || account.updatedAtMs || 0),
    String(Boolean(account.isDeleted)),
    account.deletedAtMs == null ? "" : String(account.deletedAtMs),
    account.lastOperatedDeviceName || "",
    String(account.createdAtMs || 0),
    String(account.updatedAtMs || 0),
  ]);
  return buildCsv(MACOS_EXPORT_HEADERS, rows);
}
