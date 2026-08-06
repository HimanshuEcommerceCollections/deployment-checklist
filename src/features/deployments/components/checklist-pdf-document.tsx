import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/**
 * The checklist as a PDF — the artefact teams file with a release.
 *
 * Rendered from the same data the page shows (snapshot joined with item states),
 * not from the DOM: browser print flattened the dark console into whatever the
 * print stylesheet could rescue, while this lays the record out properly — real
 * pagination, items that never split across a page break, and a footer that
 * identifies the document on every sheet.
 *
 * This module is only ever loaded through a dynamic import from the download
 * button, so @react-pdf/renderer (~1.5 MB) stays out of the page bundle until
 * someone actually asks for a PDF.
 *
 * All dates arrive as preformatted strings: the page formats them server-side in
 * the organization's timezone, and this document must agree with what the screen
 * showed rather than re-deriving its own.
 */

/** Serializable payload the checklist page assembles. */
export interface ChecklistPdfData {
  reference: string
  title: string | null
  templateName: string | null
  templateVersion: number | null
  projectName: string
  projectKey: string
  version: string
  environmentName: string
  isProduction: boolean
  status: string
  gate: 'GO' | 'HOLD' | 'SEALED'
  gateDetail: string
  startedLabel: string
  completedLabel: string
  progressLabel: string
  generatedLabel: string
  sections: Array<{
    title: string
    description: string | null
    accounted: number
    items: Array<{
      label: string
      helpText: string | null
      isRequired: boolean
      checked: boolean
      skipped: boolean
      note: string | null
      checkedLabel: string | null
    }>
  }>
}

/** The app's light-theme palette, from globals.css — the PDF is paper, not console. */
const ink = '#16202e'
const muted = '#5a6779'
const line = '#dde3ec'
const go = '#1f9d68'
const hold = '#b57d18'
const blocked = '#d1354a'

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 44,
    paddingBottom: 56,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: ink,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  eyebrow: {
    fontFamily: 'Courier',
    fontSize: 8,
    letterSpacing: 1.5,
    color: muted,
    marginBottom: 4,
  },
  heading: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  subheading: { fontSize: 9, color: muted, marginBottom: 12 },

  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: line,
    borderRadius: 4,
    padding: 10,
    marginBottom: 16,
  },
  metaCell: { width: '25%', paddingVertical: 3, paddingRight: 8 },
  metaLabel: { fontSize: 7, color: muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValue: { fontSize: 9, marginTop: 1.5 },

  gateChip: {
    alignSelf: 'flex-start',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontFamily: 'Courier-Bold',
    fontSize: 10,
    color: '#ffffff',
  },

  // ── Sections ──────────────────────────────────────────────────────────────
  section: { marginBottom: 10 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    backgroundColor: '#f4f6f9',
    borderWidth: 1,
    borderColor: line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  sectionCount: { fontFamily: 'Courier', fontSize: 8, color: muted },
  sectionDescription: { fontSize: 8, color: muted, marginTop: 2 },

  itemRow: {
    flexDirection: 'row',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: line,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tick: { fontFamily: 'Courier-Bold', fontSize: 9, width: 22 },
  itemBody: { flex: 1 },
  itemLabelLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  itemLabel: { fontSize: 9 },
  itemLabelDone: { fontSize: 9, color: muted },
  badge: {
    fontSize: 6.5,
    fontFamily: 'Courier',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 5,
  },
  helpText: { fontSize: 7.5, color: muted, marginTop: 1.5 },
  note: { fontSize: 7.5, color: ink, marginTop: 2, fontFamily: 'Helvetica-Oblique' },
  checkedBy: { fontSize: 7, fontFamily: 'Courier', color: muted, marginTop: 2 },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    left: 44,
    right: 44,
    bottom: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: line,
    paddingTop: 6,
    fontSize: 7,
    color: muted,
  },
})

const gateColor: Record<ChecklistPdfData['gate'], string> = {
  GO: go,
  HOLD: hold,
  SEALED: muted,
}

export function ChecklistPdfDocument({ data }: { data: ChecklistPdfData }) {
  return (
    <Document
      title={`${data.reference} — deployment checklist`}
      author={data.projectName}
      creator="Deployment Checklist"
    >
      <Page size="A4" style={styles.page}>
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <Text style={styles.eyebrow}>// RELEASE CONTROL — DEPLOYMENT CHECKLIST</Text>
        <Text style={styles.heading}>
          {data.title ?? `${data.reference} · ${data.version}`}
        </Text>
        <Text style={styles.subheading}>
          {data.templateName
            ? `${data.templateName} v${data.templateVersion} — ${data.reference}`
            : data.reference}
        </Text>

        <View style={styles.metaGrid}>
          {(
            [
              ['Project', `${data.projectName} (${data.projectKey})`],
              ['Version', data.version],
              [
                'Environment',
                `${data.environmentName}${data.isProduction ? ' (production)' : ''}`,
              ],
              ['Status', data.status],
              ['Started', data.startedLabel],
              ['Completed', data.completedLabel],
              ['Progress', data.progressLabel],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={styles.metaCell}>
              <Text style={styles.metaLabel}>{label}</Text>
              <Text style={styles.metaValue}>{value}</Text>
            </View>
          ))}

          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Gate</Text>
            <Text style={[styles.gateChip, { backgroundColor: gateColor[data.gate] }]}>
              {' '}
              {data.gate}{' '}
            </Text>
            {data.gateDetail ? (
              <Text style={{ fontSize: 7, color: muted, marginTop: 2 }}>{data.gateDetail}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Sections ─────────────────────────────────────────────────── */}
        {data.sections.map((section, index) => (
          <View key={index} style={styles.section}>
            {/* minPresenceAhead keeps a header from being orphaned at a page foot
                with all of its items overleaf. */}
            <View style={styles.sectionHeader} minPresenceAhead={40}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.sectionTitle}>
                  {String(index + 1).padStart(2, '0')}  {section.title}
                </Text>
                {section.description ? (
                  <Text style={styles.sectionDescription}>{section.description}</Text>
                ) : null}
              </View>
              <Text style={styles.sectionCount}>
                {section.accounted}/{section.items.length}
              </Text>
            </View>

            {section.items.map((item, itemIndex) => (
              /* wrap={false}: an item split across a page break reads as two
                 half-items, which is worse than the whitespace this costs. */
              <View key={itemIndex} style={styles.itemRow} wrap={false}>
                <Text
                  style={[
                    styles.tick,
                    { color: item.skipped ? hold : item.checked ? go : blocked },
                  ]}
                >
                  {item.skipped ? '[—]' : item.checked ? '[x]' : '[ ]'}
                </Text>

                <View style={styles.itemBody}>
                  <View style={styles.itemLabelLine}>
                    <Text style={item.checked || item.skipped ? styles.itemLabelDone : styles.itemLabel}>
                      {item.label}
                    </Text>
                    {!item.isRequired ? (
                      <Text style={[styles.badge, { color: muted }]}>optional</Text>
                    ) : null}
                    {item.skipped ? (
                      <Text style={[styles.badge, { color: hold }]}>skipped</Text>
                    ) : null}
                  </View>

                  {item.helpText ? <Text style={styles.helpText}>{item.helpText}</Text> : null}
                  {item.note ? <Text style={styles.note}>note: {item.note}</Text> : null}
                  {item.checkedLabel ? (
                    <Text style={styles.checkedBy}>{item.checkedLabel}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ))}

        {/* ── Footer, on every page ────────────────────────────────────── */}
        <View style={styles.footer} fixed>
          <Text>
            {data.reference} · {data.projectName} · {data.version} · {data.environmentName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text>{data.generatedLabel}</Text>
        </View>
      </Page>
    </Document>
  )
}
