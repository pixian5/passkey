export const FILL_CHOOSER_ACTIVATION_DEDUPE_MS = 650;

export function claimFillChooserActivation(state, input, nowMs = Date.now()) {
  if (!state || !input) return false;
  const now = Number(nowMs || 0);
  if (
    state.input === input
    && now >= Number(state.at || 0)
    && now - Number(state.at || 0) < FILL_CHOOSER_ACTIVATION_DEDUPE_MS
  ) {
    return false;
  }
  state.input = input;
  state.at = now;
  return true;
}
