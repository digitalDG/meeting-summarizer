import { z } from "zod/v4";

export const ActionItemSchema = z.object({
  task: z.string().describe("Clear description of the task to be done"),
  owner: z.string().optional().describe("Name of the person responsible, if mentioned"),
  deadline: z.string().optional().describe("Due date or timeframe, if mentioned (e.g. 'by Friday', 'next sprint')"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level if inferable from context"),
});

export const MeetingSummarySchema = z.object({
  title: z.string().describe("A concise inferred title for this meeting based on its content"),
  executive_summary: z.string().describe("2-3 sentence high-level overview of what was discussed and accomplished"),
  topics_discussed: z.array(z.string()).describe("Main topics and agenda items covered, in order"),
  key_decisions: z.array(z.string()).describe("Concrete decisions that were agreed upon by participants"),
  action_items: z.array(ActionItemSchema).describe("Tasks, follow-ups, and deliverables assigned or agreed upon"),
  open_questions: z.array(z.string()).describe("Unresolved questions, blockers, or issues requiring future discussion"),
  participants_mentioned: z.array(z.string()).describe("Names of people explicitly mentioned in the transcript"),
  next_steps: z.array(z.string()).describe("High-level planned next steps or follow-on meetings"),
});

export type ActionItem = z.infer<typeof ActionItemSchema>;
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;
