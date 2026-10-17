import { getReportWithClient } from "@/lib/data";
import { localDate } from "@/lib/period";
import { renderReportPdf } from "@/lib/report/pdf";
import { highlightsFor } from "@/lib/report/text";

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

export async function GET(_request: Request, ctx: RouteContext<"/reports/[id]/pdf">) {
  const { id } = await ctx.params;
  const report = await getReportWithClient(id);
  if (!report) return new Response("Report not found", { status: 404 });

  const pdf = await renderReportPdf({
    clientName: report.client.name,
    period: { start: report.periodStart, end: report.periodEnd },
    data: report.data,
    highlights: highlightsFor(report.data, report.highlightsOverride),
    agencyName: process.env.AGENCY_NAME || undefined,
    generatedAt: report.generatedAt,
  });

  const date = localDate(report.periodStart, report.data.timezone);
  const filename = `performance-report-${slug(report.client.name) || "client"}-${date}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
