import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/page-header";
import { button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="py-10">
      <EmptyState
        icon={<SearchX />}
        title="Not found"
        action={
          <Link href="/" className={button.secondary}>
            Back to clients
          </Link>
        }
      >
        That client or report doesn&apos;t exist, or it was deleted.
      </EmptyState>
    </div>
  );
}
