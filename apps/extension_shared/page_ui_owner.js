const PAGE_UI_PRIORITY_BASE = 1000;
const VERSION_PART_RADIX = 65536;

function parseVersionPart(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(VERSION_PART_RADIX - 1, parsed));
}

export function pageUiOwnerPriority(version) {
  const [major = "0", minor = "0", patch = "0"] = String(version || "").split(".");
  return PAGE_UI_PRIORITY_BASE
    + (parseVersionPart(major) * VERSION_PART_RADIX + parseVersionPart(minor))
      * VERSION_PART_RADIX
    + parseVersionPart(patch);
}
