#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:4321';
const ROUTES = ['/', '/posts', '/login', '/tags'];
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '844x390', width: 844, height: 390 },
];

function printHelp() {
  console.log(`Mobile viewport overflow check

Usage:
  npm run check:mobile -- --base-url http://127.0.0.1:4321

Options:
  --base-url <url>   Dev or preview server base URL. Defaults to ${DEFAULT_BASE_URL}.
  --timeout <ms>     Navigation timeout per page. Defaults to 30000.
  --help             Show this help.

Environment:
  MOBILE_CHECK_BASE_URL or BASE_URL can provide the base URL.
`);
}

function readArgValue(argv, index, name) {
  const current = argv[index];
  const equalsValue = current.slice(name.length + 1);
  if (current.startsWith(`${name}=`)) {
    return { value: equalsValue, nextIndex: index };
  }

  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }

  return { value, nextIndex: index + 1 };
}

function parseArgs(argv) {
  const options = {
    baseUrl:
      process.env.MOBILE_CHECK_BASE_URL ||
      process.env.BASE_URL ||
      DEFAULT_BASE_URL,
    timeout: 30000,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--base-url' || arg.startsWith('--base-url=')) {
      const parsed = readArgValue(argv, index, '--base-url');
      options.baseUrl = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (arg === '--timeout' || arg.startsWith('--timeout=')) {
      const parsed = readArgValue(argv, index, '--timeout');
      const timeout = Number(parsed.value);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error('--timeout must be a positive number.');
      }
      options.timeout = timeout;
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

async function loadPlaywright() {
  const packages = ['playwright', '@playwright/test'];

  for (const packageName of packages) {
    try {
      const mod = await import(packageName);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) {
        return { chromium, packageName };
      }
    } catch (error) {
      const message = String(error?.message || '');
      const isMissingPackage =
        error?.code === 'ERR_MODULE_NOT_FOUND' &&
        message.includes(packageName);

      if (!isMissingPackage) {
        throw error;
      }
    }
  }

  return null;
}

function pageUrl(baseUrl, route) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(route.replace(/^\//, ''), normalizedBase).href;
}

function selectorFor(element) {
  if (!element) {
    return '';
  }

  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes =
    typeof element.className === 'string'
      ? element.className
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((className) => `.${CSS.escape(className)}`)
          .join('')
      : '';

  return `${tag}${id}${classes}`;
}

async function measurePage(page, viewportWidth) {
  return page.evaluate((expectedViewportWidth) => {
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.ceil(
      Math.max(root?.scrollWidth || 0, body?.scrollWidth || 0),
    );
    const clientWidth = Math.ceil(root?.clientWidth || 0);
    const windowWidth = Math.ceil(window.innerWidth || clientWidth);
    const viewportWidth = windowWidth || expectedViewportWidth;
    const overflowing = scrollWidth > viewportWidth;

    let widestElement = null;
    if (overflowing && body) {
      widestElement = Array.from(body.querySelectorAll('*'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: selectorFor(element),
            width: Math.ceil(rect.width),
            right: Math.ceil(rect.right),
          };
        })
        .filter((item) => item.width > viewportWidth || item.right > viewportWidth)
        .sort((a, b) => b.width - a.width || b.right - a.right)[0];
    }

    return {
      scrollWidth,
      viewportWidth,
      clientWidth,
      overflowBy: Math.max(0, scrollWidth - viewportWidth),
      widestElement,
    };

    function selectorFor(element) {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : '';
      const classes =
        typeof element.className === 'string'
          ? element.className
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 3)
              .map((className) => `.${cssEscape(className)}`)
              .join('')
          : '';

      return `${tag}${id}${classes}`;
    }

    function cssEscape(value) {
      if (globalThis.CSS?.escape) {
        return globalThis.CSS.escape(value);
      }

      return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }
  }, viewportWidth);
}

async function checkRoute(page, route, viewport, baseUrl, timeout) {
  const url = pageUrl(baseUrl, route);
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout,
  });

  await page
    .waitForLoadState('networkidle', { timeout: Math.min(timeout, 5000) })
    .catch(() => {});
  await page.waitForTimeout(250);

  const status = response?.status() ?? null;
  const metrics = await measurePage(page, viewport.width);
  const statusOk = status === null || status < 400;
  const passed = statusOk && metrics.overflowBy === 0;

  return {
    passed,
    route,
    viewport: viewport.name,
    status,
    ...metrics,
    note: statusOk
      ? metrics.widestElement?.selector || ''
      : `HTTP status ${status}`,
  };
}

function formatRows(rows) {
  const headers = [
    'Result',
    'Viewport',
    'Route',
    'HTTP',
    'scrollWidth',
    'viewport',
    'Overflow',
    'Note',
  ];
  const values = rows.map((row) => [
    row.passed ? 'PASS' : 'FAIL',
    row.viewport,
    row.route,
    row.status ?? '-',
    row.scrollWidth ?? '-',
    row.viewportWidth ?? '-',
    row.overflowBy ? `+${row.overflowBy}px` : '0px',
    row.note || '',
  ]);
  const table = [headers, ...values];
  const widths = headers.map((_, column) =>
    Math.max(...table.map((row) => String(row[column]).length)),
  );

  return table
    .map((row, index) => {
      const line = row
        .map((value, column) => String(value).padEnd(widths[column]))
        .join('  ');
      if (index === 0) {
        return `${line}\n${widths.map((width) => '-'.repeat(width)).join('  ')}`;
      }
      return line;
    })
    .join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const playwright = await loadPlaywright();
  if (!playwright) {
    console.error('Mobile viewport check skipped: Playwright is not installed.');
    console.error(
      'Install "playwright" or "@playwright/test" in this project, then rerun "npm run check:mobile".',
    );
    console.error(
      `The script is ready to check ${ROUTES.length} routes across ${VIEWPORTS.length} viewports once the dependency exists.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Mobile viewport overflow check`);
  console.log(`Base URL: ${options.baseUrl}`);
  console.log(`Playwright package: ${playwright.packageName}`);
  console.log(`Routes: ${ROUTES.join(', ')}`);
  console.log(`Viewports: ${VIEWPORTS.map((viewport) => viewport.name).join(', ')}`);
  console.log('');

  const browser = await playwright.chromium.launch({ headless: true });
  const results = [];

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.width < 768,
        isMobile: viewport.width < 768,
      });
      const page = await context.newPage();

      try {
        for (const route of ROUTES) {
          try {
            results.push(
              await checkRoute(
                page,
                route,
                viewport,
                options.baseUrl,
                options.timeout,
              ),
            );
          } catch (error) {
            results.push({
              passed: false,
              route,
              viewport: viewport.name,
              status: '-',
              scrollWidth: '-',
              viewportWidth: viewport.width,
              overflowBy: '-',
              note: String(error?.message || error),
            });
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(formatRows(results));

  const failures = results.filter((result) => !result.passed);
  console.log('');
  if (failures.length === 0) {
    console.log(
      `PASS: ${results.length} checks completed with no horizontal overflow.`,
    );
    return;
  }

  console.log(
    `FAIL: ${failures.length} of ${results.length} checks failed. Fix overflow or route errors above.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('Mobile viewport check failed before completion.');
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
