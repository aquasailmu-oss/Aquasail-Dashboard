import type { Metadata } from "next";
import { LogoForm } from "@/components/admin/logo-form";
import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireRole } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Settings · AquaSail Ops" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const { logo_path, ...settings } = await getSettings();

  return (
    <>
      <PageHeader title="Settings" description="Company details, tickets and limits. Changes are audited." />
      <div className="grid max-w-4xl gap-6">
        <SettingsForm settings={settings} />
        <LogoForm logoPath={logo_path} />
      </div>
    </>
  );
}
