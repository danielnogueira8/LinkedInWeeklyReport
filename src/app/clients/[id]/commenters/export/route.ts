import { commentersCsv, commentersXlsx, listCommenters, parseView } from "@/lib/commenters/list";
import { getClient } from "@/lib/data";
import { localDate, reportTimezone } from "@/lib/period";

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

/** Every commenter in the view, highest ICP match first: ?format=xlsx (rows coloured by fit) or csv. */
export async function GET(request: Request, ctx: RouteContext<"/clients/[id]/commenters/export">) {
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return new Response("Client not found", { status: 404 });
  const query = new URL(request.url).searchParams;
  const view = parseView(query.get("view"));
  const excel = query.get("format") === "xlsx";

  const { commenters } = await listCommenters(client, view);
  const timezone = reportTimezone();
  const span = view === "week" ? "last-7-days" : "all-time";
  const name = `commenters-${slug(client.name) || "client"}-${span}-${localDate(new Date(), timezone)}`;
  const file = excel ? commentersXlsx(commenters, timezone) : commentersCsv(commenters, timezone);
  return new Response(typeof file === "string" ? file : new Uint8Array(file), {
    headers: {
      "Content-Type": excel
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.${excel ? "xlsx" : "csv"}"`,
      "Cache-Control": "no-store",
    },
  });
}
