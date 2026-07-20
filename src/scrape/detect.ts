/** Defines the ATS detection seam implemented by the future scraping layer. */
import type { ScrapeMethod } from '../db/index.js';
import type { HttpClient } from '../util/http.js';
import { matchSignatures } from './signatures.js';

/** Result of inspecting a company careers URL for an ATS signature. */
export interface DetectionResult {
  method: ScrapeMethod;
  slug: string | null;
  detail: string | null;
}

/** Detects the scraping method for a careers site. */
export interface AtsDetector {
  detect(careersUrl: string): Promise<DetectionResult>;
}

/** Fetches a careers page and classifies it with the pure signature matcher. */
export class SignatureDetector implements AtsDetector {
  public constructor(private readonly http: HttpClient) {}

  public async detect(careersUrl: string): Promise<DetectionResult> {
    try {
      const result = await this.http.fetchText(careersUrl);
      if (result.status < 200 || result.status >= 300) {
        return unknownResult(`fetch failed: HTTP ${result.status}`);
      }

      const match = matchSignatures(result.finalUrl, result.body);
      if (!match) {
        return unknownResult('no supported ATS signature found');
      }
      return match;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return unknownResult(`fetch failed: ${reason}`);
    }
  }
}

function unknownResult(detail: string): DetectionResult {
  return { method: 'unknown', slug: null, detail };
}
