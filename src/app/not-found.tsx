import Link from "next/link";
import { button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-zinc-600">That client or report doesn&apos;t exist (or was deleted).</p>
      <Link href="/" className={button.secondary}>
        Back to clients
      </Link>
    </div>
  );
}
