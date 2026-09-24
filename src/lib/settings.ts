import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Every app_settings key with its default, so a missing row never breaks a page. */
const SETTING_DEFAULTS = {
  company_name: "AquaSail Watersports Ltd",
  company_phone: "",
  company_email: "",
  default_meeting_point: "Marina jetty, Grand Baie",
  ticket_footer_text: "Thank you for sailing with AquaSail. See you on the water.",
  currency_label: "Rs",
  max_discount_percent_receptionist: 10,
  logo_path: "",
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

/** All settings, falling back to defaults for missing or mistyped values. */
export async function getSettings(): Promise<Settings> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("key, value").in("key", Object.keys(SETTING_DEFAULTS));
  const settings: Settings = { ...SETTING_DEFAULTS };
  for (const row of data ?? []) {
    const key = row.key as SettingKey;
    if (typeof row.value === typeof SETTING_DEFAULTS[key]) {
      (settings as Record<SettingKey, unknown>)[key] = row.value;
    }
  }
  return settings;
}
