/**
 * A full page load to a new URL after money was written. The client router
 * can drop a navigation when another Server Action (a live quote, the
 * customer lookup) finishes at the same moment; a booking must never look
 * unsaved, so after create and amend the browser navigates for real.
 */
export function openAfterSave(url: string): void {
  window.location.assign(url);
}
