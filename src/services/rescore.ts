/** Recomputes persisted open-job scores without scraping or network access. */
import type { KeywordsFile } from '../config/schema.js';
import type { Repositories } from '../db/index.js';
import { scoreJob } from '../score/engine.js';

export interface RescoreResult {
  updated: number;
}

export class RescoreService {
  public constructor(
    private readonly repositories: Repositories,
    private readonly keywords: KeywordsFile,
  ) {}

  /** Updates every open job atomically against one loaded keyword snapshot. */
  public rescoreOpen(): RescoreResult {
    const jobs = this.repositories.jobs.listOpen();
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
      }
    });
    return { updated: jobs.length };
  }
}
