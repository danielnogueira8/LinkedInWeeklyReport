import { Document, Font, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatPeriod, reportTimezone, type Period } from "@/lib/period";
import { isJoint, type ReportData } from "@/lib/report/build";
import {
  creatorStatsLine,
  formatNumber,
  parseHighlights,
  postStatsLine,
  topPosts,
  topPostsHeading,
} from "@/lib/report/text";

// react-pdf hyphenates long words by default ("fol-low-ups"); wrap on whole words only.
Font.registerHyphenationCallback((word) => [word]);

const colors = {
  ink: "#111827",
  muted: "#6B7280",
  border: "#E5E7EB",
  panel: "#F9FAFB",
  accent: "#0A66C2",
};

const styles = StyleSheet.create({
  page: { padding: 44, paddingBottom: 64, fontFamily: "Helvetica", fontSize: 10, color: colors.ink, lineHeight: 1.4 },
  eyebrow: { fontSize: 8, letterSpacing: 1.5, color: colors.accent, fontFamily: "Helvetica-Bold" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 6, lineHeight: 1.2 },
  period: { fontSize: 11, color: colors.muted, marginTop: 4 },
  rule: { height: 2, width: 36, backgroundColor: colors.accent, marginTop: 14, marginBottom: 22 },
  kpis: { flexDirection: "row", gap: 8 },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    backgroundColor: colors.panel,
  },
  kpiLabel: { fontSize: 8, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  kpiValue: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 4, lineHeight: 1.2 },
  kpiSub: { fontSize: 7.5, color: colors.muted, marginTop: 3, lineHeight: 1.3 },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 26, marginBottom: 10 },
  post: { flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  postRank: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.ink,
    color: "#FFFFFF",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingTop: 5,
  },
  postBody: { flex: 1 },
  postStats: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  postExcerpt: { color: colors.muted, marginTop: 3, fontSize: 9 },
  postLink: { color: colors.accent, marginTop: 3, fontSize: 9, textDecoration: "none" },
  paragraph: { marginBottom: 6 },
  bullet: { flexDirection: "row", marginBottom: 4, paddingLeft: 4 },
  bulletDot: { width: 12, color: colors.accent },
  bulletText: { flex: 1 },
  creator: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  creatorName: { fontFamily: "Helvetica-Bold" },
  creatorStats: { color: colors.muted },
  empty: { marginTop: 10, color: colors.muted },
  footer: {
    position: "absolute",
    left: 44,
    right: 44,
    bottom: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: colors.muted,
  },
});

// The built-in Helvetica only covers Windows-1252. Strip what it can't draw
// (emoji, arrows) so post excerpts don't turn into garbage glyphs.
const CP1252_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(text: string) {
  return [...text]
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRAS.includes(char);
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Props = {
  clientName: string;
  period: Period;
  data: ReportData;
  highlights: string;
  agencyName?: string;
  generatedAt: Date;
};

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{formatNumber(value)}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function ReportDocument({ clientName, period, data, highlights, agencyName, generatedAt }: Props) {
  const { totals, timezone } = data;
  const top = topPosts(data);
  const blocks = parseHighlights(highlights);
  const dmBreakdown =
    totals.firstDms > 0 && totals.followUps > 0
      ? `${formatNumber(totals.firstDms)} first + ${formatNumber(totals.followUps)} follow-ups`
      : undefined;

  return (
    <Document title={`Performance report · ${clientName}`} author={agencyName}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.eyebrow}>PERFORMANCE REPORT</Text>
        <Text style={styles.title}>{pdfSafe(clientName)}</Text>
        <Text style={styles.period}>{formatPeriod(period, timezone)}</Text>
        <View style={styles.rule} />

        {data.posts.length === 0 ? (
          <Text style={styles.empty}>No posts were published in this period.</Text>
        ) : (
          <>
            <View style={styles.kpis}>
              <Kpi label="Impressions" value={totals.impressions} />
              <Kpi label="Reactions" value={totals.reactions} />
              <Kpi label="Comments" value={totals.comments} />
              <Kpi label="Reposts" value={totals.reposts} />
              <Kpi label="DMs sent" value={totals.firstDms + totals.followUps} sub={dmBreakdown} />
            </View>

            {isJoint(data) ? (
              <View>
                <Text style={styles.sectionTitle}>By creator</Text>
                {data.creators!.map((creator) => (
                  <View key={creator.id} style={styles.creator} wrap={false}>
                    <Text style={styles.creatorName}>{pdfSafe(creator.name)}</Text>
                    <Text style={styles.creatorStats}>{creatorStatsLine(creator.totals)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>{topPostsHeading(top.length).replace(/:$/, "")}</Text>
            {top.map((post, index) => {
              const excerpt = pdfSafe(post.excerpt);
              return (
                <View key={post.id} style={styles.post} wrap={false}>
                  <Text style={styles.postRank}>{index + 1}</Text>
                  <View style={styles.postBody}>
                    <Text style={styles.postStats}>{postStatsLine(post, timezone)}</Text>
                    {excerpt ? <Text style={styles.postExcerpt}>{excerpt}</Text> : null}
                    {post.url ? (
                      <Link src={post.url} style={styles.postLink}>
                        View post on LinkedIn
                      </Link>
                    ) : null}
                  </View>
                </View>
              );
            })}

            {blocks.length > 0 ? (
              <View wrap={false}>
                <Text style={styles.sectionTitle}>What worked best</Text>
                {blocks.map((block, index) =>
                  block.type === "bullet" ? (
                    <View key={index} style={styles.bullet}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{pdfSafe(block.text)}</Text>
                    </View>
                  ) : (
                    <Text key={index} style={styles.paragraph}>
                      {pdfSafe(block.text)}
                    </Text>
                  ),
                )}
              </View>
            ) : null}
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>{agencyName ? `Prepared by ${pdfSafe(agencyName)}` : ""}</Text>
          <Text>
            Data from LeadShark · generated{" "}
            {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: reportTimezone() }).format(generatedAt)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export function renderReportPdf(props: Props): Promise<Buffer> {
  return renderToBuffer(<ReportDocument {...props} />);
}
