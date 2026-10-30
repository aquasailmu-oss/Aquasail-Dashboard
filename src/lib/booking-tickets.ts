export type IssuedTicket = { token: string; issued_at: string };

/** PostgREST may serialize a relationship as one object or an array. */
export function latestTicket<T extends IssuedTicket>(relation: T | T[] | null | undefined): T | null {
  const tickets = Array.isArray(relation) ? relation : relation ? [relation] : [];
  return tickets.sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0] ?? null;
}
