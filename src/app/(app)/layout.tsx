import { AppSidebar } from "@/components/shell/app-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { requireUser } from "@/lib/auth";
import { navFor } from "@/lib/navigation";
import { getSettings } from "@/lib/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AppSidebar items={navFor(user.role)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} companyName={settings.company_name} />
        <main id="main-content" className="mx-auto w-full max-w-[1360px] flex-1 p-4 md:p-6 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
