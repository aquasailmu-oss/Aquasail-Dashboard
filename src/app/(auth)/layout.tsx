import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <Image src="/aquasail-logo.svg" alt="AquaSail Watersports" width={220} height={73} priority />
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
