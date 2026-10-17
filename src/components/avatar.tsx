// Soft tinted initials, picked by name so a client keeps the same colour everywhere.
const tones = [
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
  "bg-orange-100 text-orange-800",
];

const sizes = {
  sm: "size-6 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-14 text-lg",
};

function initials(name: string) {
  const words = name.split(/[\s/]+/).filter((word) => /\p{L}/u.test(word));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

function tone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return tones[Math.abs(hash) % tones.length];
}

export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof sizes }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold ${sizes[size]} ${tone(name)}`}
    >
      {initials(name)}
    </span>
  );
}
