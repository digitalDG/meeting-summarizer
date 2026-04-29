import type { MeetingSummary } from "./schemas";

// Markdown — used for Copy to clipboard
export function formatSummaryAsText(s: MeetingSummary): string {
  const lines: string[] = [`# ${s.title}`, "", s.executive_summary];

  if (s.action_items.length > 0) {
    lines.push("", "## Action Items");
    s.action_items.forEach((a) => {
      let item = `- ${a.task}`;
      if (a.owner) item += ` [${a.owner}]`;
      if (a.deadline) item += ` · ${a.deadline}`;
      lines.push(item);
    });
  }
  if (s.key_decisions.length > 0) {
    lines.push("", "## Key Decisions");
    s.key_decisions.forEach((d) => lines.push(`- ${d}`));
  }
  if (s.next_steps.length > 0) {
    lines.push("", "## Next Steps");
    s.next_steps.forEach((n) => lines.push(`- ${n}`));
  }
  if (s.open_questions.length > 0) {
    lines.push("", "## Open Questions");
    s.open_questions.forEach((q) => lines.push(`- ${q}`));
  }
  if (s.topics_discussed.length > 0) {
    lines.push("", "## Topics Discussed");
    lines.push(s.topics_discussed.join(", "));
  }
  if (s.participants_mentioned.length > 0) {
    lines.push("", "## Participants");
    lines.push(s.participants_mentioned.join(", "));
  }

  return lines.join("\n");
}

// HTML — for rich clipboard paste into email composers
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSummaryAsHtml(s: MeetingSummary): string {
  const parts: string[] = [];
  parts.push(`<h1>${esc(s.title)}</h1>`);
  parts.push(`<p>${esc(s.executive_summary)}</p>`);

  if (s.action_items.length > 0) {
    parts.push("<h2>Action Items</h2><ul>");
    s.action_items.forEach((a) => {
      let item = esc(a.task);
      if (a.owner) item += ` <b>[${esc(a.owner)}]</b>`;
      if (a.deadline) item += ` · ${esc(a.deadline)}`;
      parts.push(`<li>${item}</li>`);
    });
    parts.push("</ul>");
  }
  if (s.key_decisions.length > 0) {
    parts.push("<h2>Key Decisions</h2><ul>");
    s.key_decisions.forEach((d) => parts.push(`<li>${esc(d)}</li>`));
    parts.push("</ul>");
  }
  if (s.next_steps.length > 0) {
    parts.push("<h2>Next Steps</h2><ul>");
    s.next_steps.forEach((n) => parts.push(`<li>${esc(n)}</li>`));
    parts.push("</ul>");
  }
  if (s.open_questions.length > 0) {
    parts.push("<h2>Open Questions</h2><ul>");
    s.open_questions.forEach((q) => parts.push(`<li>${esc(q)}</li>`));
    parts.push("</ul>");
  }
  if (s.topics_discussed.length > 0) {
    parts.push(`<h2>Topics Discussed</h2><p>${esc(s.topics_discussed.join(", "))}</p>`);
  }
  if (s.participants_mentioned.length > 0) {
    parts.push(`<h2>Participants</h2><p>${esc(s.participants_mentioned.join(", "))}</p>`);
  }
  return parts.join("\n");
}

// Plain text — for mailto: email body
export function formatSummaryAsEmailText(s: MeetingSummary): string {
  const lines: string[] = [s.title.toUpperCase(), "", s.executive_summary];

  if (s.action_items.length > 0) {
    lines.push("", "ACTION ITEMS");
    s.action_items.forEach((a) => {
      let item = `• ${a.task}`;
      if (a.owner) item += ` [${a.owner}]`;
      if (a.deadline) item += ` · ${a.deadline}`;
      lines.push(item);
    });
  }
  if (s.key_decisions.length > 0) {
    lines.push("", "KEY DECISIONS");
    s.key_decisions.forEach((d) => lines.push(`• ${d}`));
  }
  if (s.next_steps.length > 0) {
    lines.push("", "NEXT STEPS");
    s.next_steps.forEach((n) => lines.push(`• ${n}`));
  }
  if (s.open_questions.length > 0) {
    lines.push("", "OPEN QUESTIONS");
    s.open_questions.forEach((q) => lines.push(`• ${q}`));
  }
  if (s.topics_discussed.length > 0) {
    lines.push("", "TOPICS DISCUSSED");
    lines.push(s.topics_discussed.join(", "));
  }
  if (s.participants_mentioned.length > 0) {
    lines.push("", "PARTICIPANTS");
    lines.push(s.participants_mentioned.join(", "));
  }

  return lines.join("\n");
}
