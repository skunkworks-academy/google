import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../learning.css', import.meta.url), 'utf8');
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  for (const site of ['subdomain', 'academy']) {
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.addInitScript(value => localStorage.setItem('swa-theme', value), theme);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://google.skunkworksacademy.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/' || path === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        if (path === '/learning.css') return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
        return route.fulfill({ status: 404, body: '' });
      });
      await page.route('https://www.skunkworksacademy.com/google/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/google/' || path === '/google/index.html') {
          const academyHtml = html.replace('https://google.skunkworksacademy.com/"', 'https://www.skunkworksacademy.com/google/"').replace('content="index, follow"', 'content="noindex, follow"');
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: academyHtml });
        }
        if (path === '/google/learning.css') return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
        return route.fulfill({ status: 404, body: '' });
      });
      const url = site === 'subdomain' ? 'https://google.skunkworksacademy.com/' : 'https://www.skunkworksacademy.com/google/';
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.locator('.swa-global-nav').waitFor({ state: 'visible', timeout: 45000 });
        await page.locator('.swa-global-footer').waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForFunction(expected => document.documentElement.getAttribute('data-theme') === expected, theme);
      } catch (error) {
        await page.screenshot({ path: `artifacts/${site}-${theme}-${width}-readiness-failure.png`, fullPage: true }).catch(() => {});
        throw error;
      }
      await page.screenshot({ path: `artifacts/${site}-${theme}-${width}.png`, fullPage: true });
      assert.equal(await page.locator('.swa-global-nav').count(), 1, 'one Academy header');
      assert.equal(await page.locator('.swa-global-footer').count(), 1, 'one Academy footer');
      assert.equal(await page.locator('.google-fallback-header, .google-fallback-footer').count(), 0, 'fallback chrome removed');
      const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.document <= dimensions.viewport, `${theme} ${width}px: horizontal overflow`);
      const broken = await page.locator('main a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => !document.getElementById(href.slice(1))));
      assert.deepEqual(broken, [], 'all section links have targets');
      const accessibility = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(accessibility.violations.map(v => ({ id: v.id, description: v.description, nodes: v.nodes.map(n => n.target) })), [], `${theme} ${width}px: accessibility violations`);
      if (width === 390) {
        const toggle = page.locator('.swa-global-nav__toggle');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'mobile menu opens');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'mobile menu closes');
      }
      assert.deepEqual(errors, [], 'no uncaught page errors');
      console.log(`PASS ${site} ${theme} ${width}px: Academy shell, layout, navigation and WCAG checks`);
      await context.close();
    }
  }
  }
} finally {
  await browser.close();
}

