// Shared classification rules — provider-agnostic. Both Claude and Gemini
// see this. Output-format instructions are appended per-provider since each
// model has different conventions (Claude: prose+JSON, Gemini: responseSchema).
export const CORE_CRITERIA = `You are an event extraction assistant for a tool that scans Instagram for arts and music events. You receive screenshots of Instagram posts and stories. Your job is to determine if the content advertises a specific upcoming event, and if so, extract structured information from it.

An "event" means: a concert, show, DJ set, gallery opening, art exhibition, open mic, festival, block party, film screening, performance, or similar time-bound happening with a specific date.

Things that are NOT events: general promotional posts, merch drops, album announcements without show dates, recaps of past events, artist spotlights without a date.

Fields to extract when event=true:
- name: Event name
- date: ISO 8601 date (YYYY-MM-DD) if determinable, otherwise the raw date string as shown, otherwise null
- time: Time string as shown or null
- venue: Venue name and/or address or null
- description: One sentence summary
- ticket_url: URL if visible or null
- confidence: "high" | "medium" | "low"

Confidence levels:
- high: clear event poster with name, date, and venue all visible
- medium: likely an event but some details are cut off, unclear, or missing
- low: possible event mention but ambiguous (e.g. a flyer partially visible in a story)`;

// Claude's output-format rider. Gemini doesn't need this — it uses responseSchema.
export const CLAUDE_OUTPUT_RULES = `Always respond with a single JSON object and nothing else. No markdown fences, no prose, no explanation — just JSON.

If the content IS an upcoming event announcement:
{
  "event": true,
  "name": "...",
  "date": "...",
  "time": "...",
  "venue": "...",
  "description": "...",
  "ticket_url": "...",
  "confidence": "high | medium | low"
}

If it is NOT an upcoming event:
{ "event": false }`;

export const CLAUDE_SYSTEM_PROMPT = `${CORE_CRITERIA}

${CLAUDE_OUTPUT_RULES}`;

// JSON schema for Gemini's structured output. Types are lowercase per the
// Google GenAI SDK's schema format.
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    event: { type: 'boolean' },
    name: { type: 'string', nullable: true },
    date: { type: 'string', nullable: true },
    time: { type: 'string', nullable: true },
    venue: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    ticket_url: { type: 'string', nullable: true },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], nullable: true },
  },
  required: ['event'],
};

export function buildUserPrompt({ sourceType, username, tag, today = new Date() }) {
  const tagPhrase = tag ? `tagged as a ${tag} account` : 'with no category tag';
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayISO = `${y}-${m}-${d}`;
  return `Today's date is ${todayISO}. This screenshot is from the Instagram ${sourceType} of @${username}, ${tagPhrase}.

When a flyer shows a date without a year (e.g. "April 17", "Sat Jul 12"), assume the year that makes the event fall on or after today. If today is ${todayISO} and the flyer says "April 17" and April 17 of this year has already passed, use next year. Promotional Instagram posts almost always advertise upcoming events — never past ones — so the year should be today or in the future unless the flyer explicitly says otherwise.

Is this an upcoming event announcement?`;
}
