import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, } from "docx";
// Column widths in twentieths of a point (twips). 9638 = ~6.7 inches total.
const COL_TASK = 4500;
const COL_OWNER = 2000;
const COL_DEADLINE = 1638;
const COL_PRIORITY = 1500;
function heading(text, level) {
    return new Paragraph({ text, heading: level, spacing: { before: 280, after: 80 } });
}
function bullet(text) {
    return new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text, size: 22 })],
        spacing: { after: 40 },
    });
}
function cell(text, bold = false, shaded = false) {
    return new TableCell({
        children: [
            new Paragraph({
                children: [new TextRun({ text, size: 20, bold, color: shaded ? "ffffff" : "111827" })],
                spacing: { before: 60, after: 60 },
            }),
        ],
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: shaded ? { type: ShadingType.SOLID, color: "1e293b", fill: "1e293b" } : undefined,
    });
}
function actionItemsTable(items) {
    const headerRow = new TableRow({
        children: [
            cell("Task", true, true),
            cell("Owner", true, true),
            cell("Deadline", true, true),
            cell("Priority", true, true),
        ],
        tableHeader: true,
    });
    const dataRows = items.map((a) => new TableRow({
        children: [
            cell(a.task),
            cell(a.owner ?? "—"),
            cell(a.deadline ?? "—"),
            cell(a.priority ?? "medium"),
        ],
    }));
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "334155" },
        },
        rows: [headerRow, ...dataRows],
        columnWidths: [COL_TASK, COL_OWNER, COL_DEADLINE, COL_PRIORITY],
    });
}
function buildMeetingChildren(summary, label, pageBreak, timestamp) {
    const children = [];
    // Title — 20pt bold, no oversized TITLE style
    children.push(new Paragraph({
        children: [new TextRun({ text: summary.title, size: 40, bold: true, color: "111827" })],
        spacing: { after: 80 },
        pageBreakBefore: pageBreak,
    }));
    // Metadata line: date (if available) · label
    const datePart = timestamp
        ? new Date(timestamp).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })
        : null;
    const metaParts = [];
    if (datePart)
        metaParts.push(new TextRun({ text: datePart, size: 20, color: "64748b" }));
    if (datePart && label)
        metaParts.push(new TextRun({ text: "  ·  ", size: 20, color: "94a3b8" }));
    if (label)
        metaParts.push(new TextRun({ text: label, size: 20, color: "6366f1", bold: true }));
    if (metaParts.length > 0) {
        children.push(new Paragraph({ children: metaParts, spacing: { after: 280 } }));
    }
    children.push(heading("Executive Summary", HeadingLevel.HEADING_1));
    children.push(new Paragraph({
        children: [new TextRun({ text: summary.executive_summary, size: 22 })],
        spacing: { after: 120 },
    }));
    if (summary.action_items.length > 0) {
        children.push(heading("Action Items", HeadingLevel.HEADING_1));
        children.push(actionItemsTable(summary.action_items));
        children.push(new Paragraph({ text: "" }));
    }
    if (summary.key_decisions.length > 0) {
        children.push(heading("Key Decisions", HeadingLevel.HEADING_1));
        summary.key_decisions.forEach((d) => children.push(bullet(d)));
    }
    if (summary.next_steps.length > 0) {
        children.push(heading("Next Steps", HeadingLevel.HEADING_1));
        summary.next_steps.forEach((s) => children.push(bullet(s)));
    }
    if (summary.open_questions.length > 0) {
        children.push(heading("Open Questions", HeadingLevel.HEADING_1));
        summary.open_questions.forEach((q) => children.push(bullet(q)));
    }
    if (summary.topics_discussed.length > 0) {
        children.push(heading("Topics Discussed", HeadingLevel.HEADING_1));
        summary.topics_discussed.forEach((t) => children.push(bullet(t)));
    }
    if (summary.participants_mentioned.length > 0) {
        children.push(heading("Participants", HeadingLevel.HEADING_1));
        children.push(new Paragraph({
            children: [new TextRun({ text: summary.participants_mentioned.join(", "), size: 22 })],
        }));
    }
    return children;
}
function makeDoc(children) {
    return new Document({
        sections: [{ children }],
        styles: { default: { document: { run: { font: "Calibri", size: 22, color: "111827" } } } },
    });
}
async function download(doc, filename) {
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
export async function exportToDocx(summary, label = "Meeting Summary") {
    const slug = summary.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await download(makeDoc(buildMeetingChildren(summary, label, false)), `${slug}.docx`);
}
export async function exportAllToDocx(entries) {
    const children = entries.flatMap((e, i) => buildMeetingChildren({ ...e.summary, title: e.title }, e.label, i > 0, e.timestamp));
    const date = new Date().toISOString().slice(0, 10);
    await download(makeDoc(children), `meeting-history-${date}.docx`);
}
