const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const button = {
  primary: `${buttonBase} bg-zinc-900 text-white hover:bg-zinc-700`,
  secondary: `${buttonBase} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50`,
  danger: `${buttonBase} border border-red-200 bg-white text-red-600 hover:bg-red-50`,
  ghost: `${buttonBase} text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900`,
};

export const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900";

export const label = "mb-1.5 block text-sm font-medium text-zinc-700";

export const card = "rounded-xl border border-zinc-200 bg-white p-6 shadow-sm";
