import { ChartColumn, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SidebarNav, SidebarSchedule } from "@/components/sidebar";
import { listClientNames } from "@/lib/data";
import { weeklyRunLabel } from "@/lib/period";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Weekly Reports", template: "%s · Weekly Reports" },
  description: "LinkedIn performance reports for agency clients, built from LeadShark data.",
  robots: { index: false, follow: false },
};

function Brand({ agencyName }: { agencyName?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1.5">
      <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <ChartColumn className="size-4" strokeWidth={2.5} aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-zinc-950">Weekly Reports</span>
        {agencyName ? <span className="block text-xs text-zinc-500">{agencyName}</span> : null}
      </span>
    </Link>
  );
}

async function SidebarClients() {
  await connection();
  let clients: Awaited<ReturnType<typeof listClientNames>> = [];
  try {
    clients = await listClientNames();
  } catch (err) {
    // Pages show the database error; the sidebar just stays empty.
    console.error("Sidebar couldn't load clients", err);
  }
  return <SidebarNav clients={clients} schedule={weeklyRunLabel()} />;
}

function SidebarFallback() {
  return (
    <>
      <div className="space-y-2 px-2.5 py-1.5">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-20 animate-pulse rounded bg-zinc-200" />
      </div>
      <div className="flex-1" />
      <SidebarSchedule schedule={weeklyRunLabel()} />
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const agencyName = process.env.AGENCY_NAME || undefined;
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full text-zinc-900">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-zinc-200/80 px-3 py-4 lg:flex">
            <Brand agencyName={agencyName} />
            <div className="mt-7 flex min-h-0 flex-1 flex-col">
              <Suspense fallback={<SidebarFallback />}>
                <SidebarClients />
              </Suspense>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-200/80 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
              <Brand agencyName={agencyName} />
              <Link
                href="/clients/new"
                aria-label="Add client"
                className="grid size-9 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-xs"
              >
                <Plus className="size-4" aria-hidden />
              </Link>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 lg:py-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
