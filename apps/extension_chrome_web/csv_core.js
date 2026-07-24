/**
 * Shared CSV helpers for Pass surfaces.
 * Keep semantics aligned with core/pass_core/crates/csvio.
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

export function escapeCsvCell(value) {
  let sanitized = String(value ?? "").replaceAll("\r", " ").replaceAll("\n", " ");
  if (/^[=+\-@\t]/.test(sanitized)) sanitized = `'${sanitized}`;
  return `"${sanitized.replaceAll('"', '""')}"`;
}

export function buildCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvCell(cell)).join(","));
  }
  return lines.join("\n");
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const source = String(text || "");
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim())) rows.push(row);
  }
  return rows;
}

export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return { headers: [], rows: [] };
  return { headers: rows[0].map((h) => String(h || "").trim()), rows: rows.slice(1) };
}

export function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[ \t_\-]/g, "");
}

export function hostFromSiteValue(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const withoutScheme = t.replace(/^https?:\/\//i, "");
  let host = withoutScheme.split(/[\/?#:]/)[0] || "";
  host = host.replace(/^\[/, "").replace(/\]$/, "").replace(/^www\./i, "").trim().toLowerCase();
  return host;
}

function mapGet(map, names) {
  for (const name of names) {
    if (map[name] != null && map[name] !== "") return map[name];
  }
  return "";
}

export function browserCsvToAccountDrafts(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const drafts = [];
  for (const row of rows.slice(1)) {
    const map = {};
    headers.forEach((header, index) => {
      if (!header) return;
      map[header] = String(row[index] ?? "").trim();
    });
    const siteRaw = mapGet(map, ["url", "origin", "website", "hostname", "loginuri", "loginurl", "sites", "name"]);
    const site = hostFromSiteValue(siteRaw);
    if (!site) continue;
    let note = mapGet(map, ["note", "notes", "extra", "comments", "comment"]);
    if (!note) {
      const name = map.name || "";
      const nameHost = hostFromSiteValue(name);
      if (name && name.toLowerCase() !== site && nameHost !== site) note = name;
    }
    drafts.push({
      sites: [site],
      username: mapGet(map, ["username", "user", "loginusername", "login", "username"]),
      password: mapGet(map, ["password", "pass", "loginpassword", "passwd"]),
      note,
      totpSecret: mapGet(map, ["totp", "totpsecret", "otpauth", "otp", "otpsecre"]),
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
