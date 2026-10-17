const buttonBase =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export const button = {
  primary: `${buttonBase} bg-zinc-900 text-white shadow-sm hover:bg-zinc-700`,
  secondary: `${buttonBase} border border-zinc-200 bg-white text-zinc-800 shadow-xs hover:bg-zinc-50 hover:text-zinc-950`,
  danger: `${buttonBase} border border-red-200 bg-white text-red-600 hover:bg-red-50`,
  ghost: `${buttonBase} text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900`,
};

export const input =
  "h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100";

export const textarea =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100";

export const label = "mb-1.5 block text-sm font-medium text-zinc-700";

export const card = "rounded-xl border border-zinc-200/80 bg-white shadow-xs";

export const cardHeader = "flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5";

export const cardTitle = "text-sm font-semibold text-zinc-900";

export const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
