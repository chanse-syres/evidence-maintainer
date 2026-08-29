export interface Player { id: string; name: string }

export function extractPlayers(payload: unknown): Player[] {
  const players = (payload as { players?: Player[] }).players ?? [];
  return players.map(({ id, name }) => ({ id, name }));
}
