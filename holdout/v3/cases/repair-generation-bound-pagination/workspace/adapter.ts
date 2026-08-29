export interface CatalogRecord { id: string; value: number }
export interface CatalogPage {
  generation: number;
  requestCursor: string | null;
  nextCursor: string | null;
  records: CatalogRecord[];
}

export function materializeSnapshot(pages: CatalogPage[]): CatalogRecord[] {
  const records = new Map<string, CatalogRecord>();
  for (const page of pages) {
    for (const record of page.records) records.set(record.id, record);
  }
  return [...records.values()];
}
