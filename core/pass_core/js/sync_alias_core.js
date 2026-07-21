/**
 * Extension-side alias group helper aligned with Rust `sync_alias_groups`.
 * Prefer keeping logic in Core; this is for browser runtime until WASM lands.
 *
 * Connectivity: site-set overlap OR same eTLD+1 (via helpers.etldPlusOne).
 */
export function syncAliasGroups(accounts, helpers, options = {}) {
  if (!Array.isArray(accounts) || accounts.length < 2) {
    return { accounts, changed: false };
  }
  const normalize = helpers?.normalizeDomain || ((s) => String(s || "").trim().toLowerCase());
  const etldPlusOne =
    helpers?.etldPlusOne ||
    ((s) => {
      const n = normalize(s);
      const parts = n.split(".").filter(Boolean);
      if (parts.length < 2) return n;
      return parts.slice(-2).join(".");
    });
  const nowMs = options.nowMs ?? Date.now();
  const deviceName = options.deviceName || "Browser";

  const n = accounts.length;
  const siteSets = accounts.map((a) => {
    const sites = Array.isArray(a?.sites) ? a.sites : [];
    return new Set(sites.map(normalize).filter(Boolean));
  });
  const etldSets = siteSets.map((set) => {
    const out = new Set();
    for (const s of set) {
      const e = etldPlusOne(s);
      if (e) out.add(e);
    }
    return out;
  });

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    let cur = i;
    while (parent[cur] !== cur) cur = parent[cur];
    let c2 = i;
    while (parent[c2] !== c2) {
      const next = parent[c2];
      parent[c2] = cur;
      c2 = next;
    }
    return cur;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let overlap = false;
      for (const s of siteSets[i]) {
        if (siteSets[j].has(s)) {
          overlap = true;
          break;
        }
      }
      let sameEtld = false;
      for (const e of etldSets[i]) {
        if (etldSets[j].has(e)) {
          sameEtld = true;
          break;
        }
      }
      if (overlap || sameEtld) union(i, j);
    }
  }

  const components = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) components[find(i)].push(i);

  let changed = false;
  const next = accounts.map((a) => ({ ...a }));
  for (const component of components) {
    if (component.length < 2) continue;
    const merged = [];
    const seen = new Set();
    for (const idx of component) {
      for (const s of siteSets[idx]) {
        if (!seen.has(s)) {
          seen.add(s);
          merged.push(s);
        }
      }
    }
    merged.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const idx of component) {
      const prev = Array.isArray(next[idx].sites)
        ? [...new Set(next[idx].sites.map(normalize).filter(Boolean))].sort((a, b) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        : [];
      const same =
        prev.length === merged.length && prev.every((v, i) => v === merged[i]);
      if (!same) {
        next[idx] = {
          ...next[idx],
          sites: merged.slice(),
          updatedAtMs: nowMs,
          lastOperatedDeviceName: deviceName,
        };
        changed = true;
      } else if (
        Array.isArray(next[idx].sites) &&
        next[idx].sites.join("\0") !== merged.join("\0")
      ) {
        // Normalize order/duplicates even if set-equal.
        next[idx] = {
          ...next[idx],
          sites: merged.slice(),
        };
        changed = true;
      }
    }
  }

  return { accounts: next, changed };
}
