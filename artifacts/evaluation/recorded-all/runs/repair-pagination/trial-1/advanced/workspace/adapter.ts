export interface Page { records: string[]; nextPage: string | null }

export function collectPages(loadPage: (address: string) => Page, start: string): string[] {
  const records: string[] = [];
  const seen = new Set<string>();
  let address: string | null = start;
  while (address !== null) {
    if (seen.has(address)) throw new Error("Pagination cycle detected");
    seen.add(address);
    const page = loadPage(address);
    records.push(...page.records);
    address = page.nextPage;
  }
  return [...new Set(records)];
}
