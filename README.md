A command-line application that runs a personal job-search operation on autopilot.

## Development setup

```bash
npm install
npx playwright install chromium
npm run build
```

Chromium is downloaded separately from the Playwright package. It is launched lazily only when a
company requires client-side rendering; static and Tier-1 ATS scans do not start a browser.
