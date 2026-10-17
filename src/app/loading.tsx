export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded bg-zinc-200" />
      <div className="h-4 w-72 rounded bg-zinc-200" />
      <div className="h-40 rounded-xl bg-zinc-200" />
    </div>
  );
}
