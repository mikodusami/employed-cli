/** Shared, lazy Playwright browser lifecycle for one employed process. */
import { chromium, type Browser, type Page } from 'playwright';

import { CaptureTimeoutError } from '../util/errors.js';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);

export type BrowserLauncher = () => Promise<Browser>;

/** Borrows isolated pages from one lazily launched Chromium instance. */
export class BrowserPool {
  private browserPromise: Promise<Browser> | null = null;

  public constructor(
    private readonly navTimeoutMs = 30_000,
    private readonly launch: BrowserLauncher = () => chromium.launch(),
  ) {}

  public async page<Result>(
    operation: (page: Page) => Promise<Result>,
    deadlineMs = this.navTimeoutMs,
  ): Promise<Result> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(this.navTimeoutMs);
    page.setDefaultTimeout(this.navTimeoutMs);
    await page.route('**/*', async (route) => {
      if (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())) {
        await route.abort();
        return;
      }
      await route.continue();
    });
    try {
      return await withPageDeadline(operation(page), page, deadlineMs);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** Closes the shared browser, including after an operation failure. */
  public async close(): Promise<void> {
    const pending = this.browserPromise;
    this.browserPromise = null;
    if (pending) {
      await (await pending).close();
    }
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.launch().catch((error: unknown) => {
        this.browserPromise = null;
        throw error;
      });
    }
    return this.browserPromise;
  }
}

async function withPageDeadline<Result>(
  operation: Promise<Result>,
  page: Page,
  deadlineMs: number,
): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void page.close().catch(() => undefined);
      reject(new CaptureTimeoutError(`Browser operation exceeded ${deadlineMs}ms deadline.`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
