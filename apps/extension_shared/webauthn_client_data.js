function normalizeHttpOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null") return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function readLocationOrigin(target) {
  try {
    return normalizeHttpOrigin(target?.location?.origin);
  } catch {
    return "";
  }
}

function readAncestorOrigins(targetWindow) {
  try {
    return Array.from(targetWindow?.location?.ancestorOrigins || [])
      .map(normalizeHttpOrigin)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveWebAuthnWindowContext(targetWindow) {
  if (!targetWindow) {
    return { origin: "", host: "", crossOrigin: false, topOrigin: "" };
  }

  let isTopLevel = true;
  try {
    isTopLevel = targetWindow.top === targetWindow.self;
  } catch {
    isTopLevel = false;
  }

  const ancestorOrigins = readAncestorOrigins(targetWindow);
  let origin = readLocationOrigin(targetWindow);
  if (!origin && !isTopLevel) {
    origin = readLocationOrigin(targetWindow.parent) || ancestorOrigins[0] || "";
  }

  let topOrigin = isTopLevel ? origin : readLocationOrigin(targetWindow.top);
  if (!topOrigin && ancestorOrigins.length > 0) {
    topOrigin = ancestorOrigins[ancestorOrigins.length - 1];
  }

  const crossOrigin = !isTopLevel && (!origin || !topOrigin || origin !== topOrigin);
  let host = "";
  try {
    host = origin ? new URL(origin).hostname : "";
  } catch {
    host = "";
  }

  return {
    origin,
    host,
    crossOrigin,
    topOrigin: crossOrigin ? topOrigin : "",
  };
}

export function buildWebAuthnClientDataJSON({
  type,
  challengeB64u,
  origin,
  crossOrigin = false,
  topOrigin = "",
}) {
  const payload = {
    type: String(type || ""),
    challenge: String(challengeB64u || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
    origin: normalizeHttpOrigin(origin) || String(origin || ""),
  };

  payload.crossOrigin = Boolean(crossOrigin);
  if (payload.crossOrigin) {
    const normalizedTopOrigin = normalizeHttpOrigin(topOrigin);
    if (normalizedTopOrigin) payload.topOrigin = normalizedTopOrigin;
  }

  return new TextEncoder().encode(JSON.stringify(payload));
}

export function buildCreateClientExtensionResults(extensions) {
  const results = {};
  if (extensions?.credProps === true) {
    results.credProps = { rk: true };
  }
  return results;
}
