import { ChevronRight } from "lucide-react";
import Link from "next/link";

type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  description,
  actions,
  leading,
  crumbs,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="mb-8">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-zinc-500">
          {crumbs.map((crumb, index) => (
            <span key={crumb.label} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-zinc-300" aria-hidden /> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="truncate hover:text-zinc-900">
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-zinc-900">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
            {description ? <div className="mt-1 text-sm text-zinc-500">{description}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-zinc-300 bg-white/60 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-600 [&_svg]:size-5">
        {icon}
      </span>
      <h2 className="mt-4 font-semibold text-zinc-900">{title}</h2>
      {children ? <p className="mt-1 max-w-sm text-sm text-zinc-500">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
