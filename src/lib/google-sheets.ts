import "server-only";

import { createSign } from "node:crypto";

type GoogleServiceAccount = { client_email?: string; private_key?: string };
type GoogleValuesResponse = { values?: unknown[][] };
let cachedToken: { value: string; expiresAt: number } | null = null;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function serviceAccount(): { email: string; privateKey: string } {
  let parsed: GoogleServiceAccount;
  try {
    parsed = JSON.parse(required("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON")) as GoogleServiceAccount;
  } catch {
    throw new Error("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON must contain the service account JSON.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("The Google Sheets service account JSON is missing its email or private key.");
  }
  return { email: parsed.client_email, privateKey: parsed.private_key.replace(/\\n/g, "\n") };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const account = serviceAccount();
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: account.email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.privateKey).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google authentication failed. Check the service account configuration.");
  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Google did not return an access token.");
  cachedToken = { value: token.access_token, expiresAt: Date.now() + 55 * 60_000 };
  return token.access_token;
}

function spreadsheetId(): string {
  return required("GOOGLE_SHEETS_SPREADSHEET_ID");
}

function tabRange(tab: string, columns: string): string {
  return `'${tab.replaceAll("'", "''")}'!${columns}`;
}

async function requestGoogle<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google Sheets request failed with status ${response.status}.`);
  return (await response.json()) as T;
}

export function isGoogleSheetsSyncConfigured(): boolean {
  return (
    process.env.GOOGLE_SHEETS_SYNC_ENABLED === "true" &&
    Boolean(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON?.trim()) &&
    Boolean(process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()) &&
    Boolean(process.env.GOOGLE_SHEETS_TAB?.trim())
  );
}

/** Reads the key column so syncs can update rows even if staff sort the Sheet. */
export async function findBookingSheetRow(bookingId: string): Promise<number | null> {
  const tab = required("GOOGLE_SHEETS_TAB");
  const result = await requestGoogle<GoogleValuesResponse>(
    `/values/${encodeURIComponent(tabRange(tab, "A:A"))}?majorDimension=ROWS`,
  );
  const rowIndex = result.values?.findIndex((row) => row[0] === bookingId) ?? -1;
  return rowIndex < 0 ? null : rowIndex + 1;
}

export async function appendBookingSheetRow(values: unknown[]): Promise<void> {
  const tab = required("GOOGLE_SHEETS_TAB");
  const range = encodeURIComponent(tabRange(tab, "A:T"));
  await requestGoogle(`/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
  });
}

/** Updates app-owned cells only; the two employee-entered share cells survive resyncs. */
export async function updateBookingSheetRow(
  row: number,
  values: unknown[],
  isOperatorAccountPrebook: boolean,
): Promise<void> {
  const tab = required("GOOGLE_SHEETS_TAB");
  const data = [
    { range: tabRange(tab, `A${row}:R${row}`), majorDimension: "ROWS", values: [values.slice(0, 18)] },
  ];
  if (!isOperatorAccountPrebook) {
    data.push({
      range: tabRange(tab, `S${row}:T${row}`),
      majorDimension: "ROWS",
      values: [values.slice(18, 20)],
    });
  }
  await requestGoogle(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data }),
  });
}
