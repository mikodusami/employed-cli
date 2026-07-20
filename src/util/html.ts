/** Small HTML text helpers that avoid a DOM dependency for ATS descriptions. */

/** Removes tags and collapses whitespace while preserving readable text content. */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
