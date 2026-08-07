
export function normalizeFillChooserQuery(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function filterFillChooserAccounts(accounts, query) {
  if (!Array.isArray(accounts)) return [];
  const normalizedQuery = normalizeFillChooserQuery(query);
  if (!normalizedQuery) return accounts.slice();
  return accounts.filter((account) => normalizeFillChooserQuery(account?.username).includes(normalizedQuery));
}
