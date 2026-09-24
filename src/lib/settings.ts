import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Every app_settings key with its default, so a missing row never breaks a page. */
const DEFAULTS = {
  company_name: "AquaSail Watersports Ltd",
};

type Settings = typeof DEFAULTS;

/** All settings, falling back to defaults for missing or mistyped values. */
export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value").in("key", Object.keys(DEFAULTS));
  const settings: Settings = { ...DEFAULTS };
  for (const row of data ?? []) {
    const key = row.key as keyof Settings;
    if (typeof row.value === typeof DEFAULTS[key]) settings[key] = row.value as Settings[typeof key];
  }
  return settings;
}
