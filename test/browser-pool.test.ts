/** Verifies shared launch, resource blocking, page release, and failure cleanup. */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Browser, Page, Route } from 'playwright';

import { BrowserPool } from '../src/scrape/browser.js';

test('browser pool launches once and blocks expensive resource types', async () => {
  const fixture = browserFixture();
  const pool = new BrowserPool(1234, fixture.launch);

  await pool.page(async (page) => exerciseRoutes(page as FakePage));
  await pool.page(async () => 'second company');
  await pool.close();

  assert.equal(fixture.launches, 1);
  assert.equal(fixture.pages.length, 2);
  assert.deepEqual(fixture.pages[0]?.timeouts, [1234, 1234]);
  assert.equal(fixture.pages[0]?.aborts, 3);
  assert.equal(fixture.pages[0]?.continues, 1);
  assert.equal(fixture.pages.every((page) => page.closed), true);
  assert.equal(fixture.browserClosed, 1);
});

test('caller finally closes the browser after a scrape operation throws', async () => {
  const fixture = browserFixture();
  const pool = new BrowserPool(30_000, fixture.launch);

  await assert.rejects(async () => {
    try {
      await pool.page(async () => {
        throw new Error('selector broke');
      });
    } finally {
      await pool.close();
    }
  }, /selector broke/);

  assert.equal(fixture.pages[0]?.closed, true);
  assert.equal(fixture.browserClosed, 1);
});

interface FakePage {
  timeouts: number[];
  handler: ((route: Route) => Promise<void>) | null;
  aborts: number;
  continues: number;
  closed: boolean;
}

function browserFixture() {
  const pages: FakePage[] = [];
  let launches = 0;
  let browserClosed = 0;
  const browser = {
    newPage: async () => {
      const state: FakePage = {
        timeouts: [],
        handler: null,
        aborts: 0,
        continues: 0,
        closed: false,
      };
      pages.push(state);
      return Object.assign(state, {
        setDefaultNavigationTimeout: (value: number) => state.timeouts.push(value),
        setDefaultTimeout: (value: number) => state.timeouts.push(value),
        route: async (_pattern: string, handler: (route: Route) => Promise<void>) => {
          state.handler = handler;
        },
        close: async () => {
          state.closed = true;
        },
      }) as unknown as Page;
    },
    close: async () => {
      browserClosed += 1;
    },
  } as unknown as Browser;
  return {
    pages,
    get launches() {
      return launches;
    },
    get browserClosed() {
      return browserClosed;
    },
    launch: async () => {
      launches += 1;
      return browser;
    },
  };
}

async function exerciseRoutes(page: FakePage): Promise<void> {
  assert.ok(page.handler);
  for (const resourceType of ['image', 'font', 'media', 'script']) {
    const route = {
      request: () => ({ resourceType: () => resourceType }),
      abort: async () => {
        page.aborts += 1;
      },
      continue: async () => {
        page.continues += 1;
      },
    } as unknown as Route;
    await page.handler(route);
  }
}
