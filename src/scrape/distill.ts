/** Pure HTML reduction for stable, bounded scraper-generation prompts. */
import { load } from 'cheerio';

const MAX_DOM_BYTES = 35 * 1024;
const KEEP_ATTRIBUTE = /^(id|class|href|aria-[\w-]+|data-[\w-]+)$/i;

export interface DistilledDom {
  dom: string;
  linkDensityHint: string;
}

/** Removes non-structural noise and centers a bounded window on the densest link region. */
export function distillDom(html: string): DistilledDom {
  const $ = load(html);
  $('script, style, svg').remove();
  $.root()
    .find('*')
    .addBack()
    .contents()
    .filter((_index, node) => node.type === 'comment')
    .remove();

  $('*').each((_index, element) => {
    if (!('attribs' in element)) {
      return;
    }
    for (const attribute of Object.keys(element.attribs)) {
      if (!KEEP_ATTRIBUTE.test(attribute)) {
        $(element).removeAttr(attribute);
      }
    }
  });

  let bestHtml = '';
  let bestLinks = 0;
  let bestScore = -1;
  $('body, body *').each((_index, element) => {
    if (!('tagName' in element)) {
      return;
    }
    const candidate = $(element);
    const links = candidate.find('a[href]').length + (element.tagName === 'a' ? 1 : 0);
    // A singleton navigation link is not useful evidence of a repeated job-list region.
    if (links < 2) {
      return;
    }
    const textLength = collapseWhitespace(candidate.text()).length;
    const score = links / Math.max(1, textLength / 80);
    if (score > bestScore || (score === bestScore && links > bestLinks)) {
      bestScore = score;
      bestLinks = links;
      bestHtml = $.html(element);
    }
  });

  const document = collapseWhitespace($.html());
  const focus = collapseWhitespace(bestHtml);
  return {
    dom: centeredByteWindow(document, focus, MAX_DOM_BYTES),
    linkDensityHint:
      bestLinks > 0
        ? `Centered near a subtree containing ${bestLinks} links.`
        : 'No linked subtree was detected.',
  };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function centeredByteWindow(document: string, focus: string, maxBytes: number): string {
  if (Buffer.byteLength(document) <= maxBytes) {
    return document;
  }
  const focusIndex = focus.length > 0 ? document.indexOf(focus) : -1;
  const center = focusIndex >= 0 ? focusIndex + Math.floor(focus.length / 2) : document.length / 2;
  const approximateCharacters = Math.min(document.length, maxBytes);
  const start = Math.max(0, Math.floor(center - approximateCharacters / 2));
  let window = document.slice(start, start + approximateCharacters);
  while (Buffer.byteLength(window) > maxBytes) {
    window = window.slice(0, -1);
  }
  return window;
}
