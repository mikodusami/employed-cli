/** Small HTML text helpers that avoid a DOM dependency for ATS descriptions. */

/** Removes tags and collapses whitespace while preserving readable text content. */
export function stripHtmlTags(html: string): string {
  const decodedMarkup = html
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ');
  return decodedMarkup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
