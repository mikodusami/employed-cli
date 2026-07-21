/** Recomputes persisted open-job scores without scraping or network access. */
import type { KeywordsFile } from '../config/schema.js';
import type { Band, Repositories } from '../db/index.js';
import { scoreJob } from '../score/engine.js';

/** A→D ranked best to worst, so "up" means a strictly higher rank after rescoring. */
const BAND_RANK: Readonly<Record<Band, number>> = { A: 4, B: 3, C: 2, D: 1 };

export interface RescoreResult {
  updated: number;
  /** Jobs whose band improved (e.g. C → B) as a result of this rescore. */
  bandUp: number;
  /** Jobs whose band worsened (e.g. B → C) as a result of this rescore. */
  bandDown: number;
}

export class RescoreService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly keywords: KeywordsFile,
  ) {}

  /**
   * Updates every open job atomically against one loaded keyword snapshot.
   *
   * @remarks Reports a band-change diff rather than silently bulk-updating, so a matcher or
   * keyword-list change (like the word-boundary fix) has a visible before/after impact on
   * already-stored jobs instead of just a count of "how many rows changed."
   */
  public rescoreOpen(): RescoreResult {
    const jobs = this.repositories.jobs.listOpen();
    let bandUp = 0;
    let bandDown = 0;
    this.repositories.withTransaction(() => {
      for (const job of jobs) {
        const result = scoreJob(
          { title: job.title, description: job.description },
          this.keywords,
        );
        this.repositories.jobs.updateScore({
          id: job.id,
          score: result.score,
          band: result.band,
          matched_kw: JSON.stringify(result.matchedKeywords),
        });
        if (job.band && job.band !== result.band) {
          if (BAND_RANK[result.band] > BAND_RANK[job.band]) {
            bandUp += 1;
          } else {
            bandDown += 1;
          }
        }
      }
    });
    return { updated: jobs.length, bandUp, bandDown };
  }
}
