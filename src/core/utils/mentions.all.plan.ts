/**
 * Plan how to deliver `"mentions": ["all"]` for a group message.
 *
 * - expand: list every participant as a mention (original WAHA behaviour, notifies everyone,
 *           but WhatsApp shows plain text instead of the native "@all" pill).
 * - native: send only WhatsApp's native @all marker (contextInfo.nonJidMentions = 1).
 * - both:   native marker plus the explicit participant list (fallback if native alone is not notified).
 *
 * Kept free of framework imports so it can be unit tested on its own.
 */
export type MentionAllMode = 'expand' | 'native' | 'both';

export const ALL = 'all';

export function parseMentionAllMode(value?: string): MentionAllMode {
  const v = (value || '').trim().toLowerCase();
  return v === 'native' || v === 'both' ? v : 'expand';
}

export async function planMentionsAll(
  mentions: string[],
  mode: MentionAllMode,
  resolveParticipants: () => Promise<string[]>,
): Promise<{ mentions: string[]; native: boolean }> {
  const others = mentions.filter((m) => m !== ALL);
  if (mode === 'native') {
    return { mentions: others, native: true };
  }
  const participants = await resolveParticipants();
  const merged = Array.from(new Set([...others, ...participants]));
  return { mentions: merged, native: mode === 'both' };
}
