export interface Page { records: string[]; nextPage: string | null }

export function collectPages(loadPage: (address: string) => Page, start: string): string[] {
  const records: string[] = [];
  let address: string | null = start;
  while (address !== null) {
    const page = loadPage(address);
    records.push(...page.records);
    address = page.nextPage;
  }
  return records;
}
