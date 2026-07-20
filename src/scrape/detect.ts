/** Defines the ATS detection seam implemented by the future scraping layer. */
import type { ScrapeMethod } from '../db/index.js';

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

/** Provides deterministic no-network detection until Layer 3. */
export class StubDetector implements AtsDetector {
  public async detect(_careersUrl: string): Promise<DetectionResult> {
    return {
      method: 'unknown',
      slug: null,
      detail: 'detection not yet implemented',
    };
  }
}
