export interface Page { records: string[]; nextPage: string | null }

export function collectPages(loadPage: (address: string) => Page, start: string): string[] {
  const records: string[] = [];
  let page = Number(start);
  while (Number.isInteger(page) && page <= 10) {
    records.push(...loadPage(String(page)).records);
    page += 1;
  }
  return records;
}
