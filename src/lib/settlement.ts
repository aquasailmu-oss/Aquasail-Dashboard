export function bookingShares(total: number, manual: boolean, entered: number | null) {
  const aquasail = manual ? entered : Math.ceil(total / 2);
  return { aquasail, operator: aquasail === null ? null : total - aquasail };
}
