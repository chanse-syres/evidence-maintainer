export interface Athlete { id: string; name: string }

export function extractAthletes(html: string): Athlete[] {
  const pattern = /<article\b[^>]*\bdata-athlete-id="([^"]+)"[^>]*>\s*<span\b[^>]*\bdata-name\b[^>]*>([^<]+)<\/span>\s*<\/article>/g;
  return [...html.matchAll(pattern)].map((match) => ({ id: match[1], name: match[2] }));
}
