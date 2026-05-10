/**
 * Rough reading-time estimate. Strips fenced code blocks and JSX tags so the
 * count reflects prose, not source listings.
 */
export function readingMinutes(body: string, wpm = 220): number {
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#*_`>\[\]]/g, ' ');
  const words = stripped.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / wpm));
}
