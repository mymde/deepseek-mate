// Shared Playwright launcher for the screenshot and end-to-end scripts.
//
// The scripts were originally written on one Linux machine with a custom Playwright
// checkout; resolve both the module and the browser without hardcoding that machine:
//   PLAYWRIGHT_CORE  module specifier or path to playwright-core (default: playwright-core)
//   CHROME_PATH      Chrome/Chromium executable (default: /usr/bin/google-chrome)
const playwrightModule = process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
const { chromium } = await import(playwrightModule)

export const executablePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
export { chromium }
