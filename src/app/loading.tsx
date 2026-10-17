export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-8 flex items-center gap-4">
        <div className="size-14 rounded-full bg-zinc-200/80" />
        <div className="space-y-2">
          <div className="h-6 w-56 rounded-md bg-zinc-200/80" />
          <div className="h-4 w-72 rounded-md bg-zinc-200/60" />
        </div>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 rounded-xl border border-zinc-200/80 bg-white" />
        ))}
      </div>
      <div className="h-72 rounded-xl border border-zinc-200/80 bg-white" />
    </div>
  );
}
