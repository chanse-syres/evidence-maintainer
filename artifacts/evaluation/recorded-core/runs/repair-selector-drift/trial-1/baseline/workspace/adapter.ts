export interface Athlete { id: string; name: string }

export function extractAthletes(html: string): Athlete[] {
  const pattern = /<article class="roster-person" data-athlete-id="([^"]+)"><span data-name>([^<]+)<\/span><\/article>/g;
  return [...html.matchAll(pattern)].map((match) => ({ id: match[1], name: match[2] }));
}
