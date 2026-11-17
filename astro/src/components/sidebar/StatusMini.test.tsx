import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import StatusMini from './StatusMini';

/**
 * StatusMini 生产缺陷回归（浏览器验收发现的两处）。
 *
 * 1. `/api/public/status` 可能返回 `{ overall: 'unknown' }` 或完全没有 `services`。
 *    旧实现 `status?.services.find(...)` 在这种情况下抛
 *    "Cannot read properties of undefined (reading 'find')"，整块卡片崩掉。
 *    这里锁定：无 services 时不抛错、三态文案与占位符仍在、正常数据仍取 site 项。
 *
 * 2. 全局 `a/a:hover/.dark a/.dark a:hover` 的旧 teal 颜色（未分层规则）会盖掉
 *    Tailwind 工具类，sf 主按钮实测 rgb(20,184,166) on rgb(11,109,118)。
 *    这里用静态断言锁定 global.css 的链接颜色只剩 `inherit`，且必须位于
 *    `@layer base` 内 —— 未分层规则在层叠中高于 @layer utilities，只有放回
 *    base 层，组件自己的 `text-[var(--sf-on-accent)]` 才能生效。
 */

/* ===========================
   数据态回归
   =========================== */

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

/** 只实现 StatusMini 会调的三个端点；其余路径直接报错，避免测试悄悄放行。 */
function stubFetch(statusBody: unknown, protection: unknown = { safeline: { state: 'ok', blocked: 7 } }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/public/status')) return okJson(statusBody);
    if (url.startsWith('/api/public/protection')) return okJson(protection);
    if (url.startsWith('/api/public/ping')) return okJson({ t: 0 });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * 等「状态数据真的回到组件」再断言。
 *
 * 组件首次渲染（status 为 null）本来就会显示「检测中」+ 占位符，所以只看首次渲染
 * 抓不到崩溃：status 落地后 render 抛错，React 会把整棵 DOM 清空。这里用可选的
 * 防护统计行 + 一次宏任务 flush 作为「本次请求已全部落定」的信号，再断言卡片仍在。
 */
async function settleStatusData(container: HTMLElement): Promise<void> {
  await screen.findByText('24h 攻击拦截');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container.textContent, '状态数据到达后卡片不应被渲染错误清空').toContain('24h 攻击拦截');
}

describe('StatusMini · 状态接口容错', () => {
  it('json 只有 {overall:"unknown"}（无 services）时不崩溃，文案回退「检测中」', async () => {
    stubFetch({ overall: 'unknown' });

    const { container } = render(<StatusMini />);
    await settleStatusData(container);

    expect(container.textContent).toContain('检测中');
    // 三块指标与说明文案仍在，且 site 缺失时用占位符而不是 undefined
    expect(container.textContent).toContain('24h 延迟');
    expect(container.textContent).toContain('24h 可用率');
    expect(container.textContent).toContain('你的延迟');
    expect((container.textContent ?? '').match(/—/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('undefined');
  });

  it('正常 services 数据仍取 site 项的 24h 延迟与可用率（不被其它 key 干扰）', async () => {
    stubFetch({
      overall: 'operational',
      services: [
        { key: 'pb', ok: true, avgLatency24h: 999, uptime24h: 42 },
        { key: 'site', ok: true, avgLatency24h: 128, uptime24h: 99.94 },
      ],
    });

    const { container } = render(<StatusMini />);

    expect(await screen.findByText('运行正常')).toBeTruthy();
    await settleStatusData(container);
    expect(container.textContent).toContain('128');
    expect(container.textContent).toContain('99.94');
    expect(container.textContent, '不应取到非 site 服务的数值').not.toContain('999');
  });

  it('未知 overall 值（如 maintenance）文案不空白，回退「检测中」', async () => {
    stubFetch({
      overall: 'maintenance',
      services: [{ key: 'site', ok: null, avgLatency24h: null, uptime24h: null }],
    });

    const { container } = render(<StatusMini />);
    await settleStatusData(container);

    // 文案必须回退到「检测中」，而不是渲染 undefined / 空串
    expect(container.textContent).toContain('检测中');
    expect(container.textContent).not.toContain('undefined');
    const label = await screen.findByText('检测中');
    expect(label.textContent?.trim()).toBe('检测中');
  });

  it('未知 overall 值 + 无 services 同时出现仍然不崩溃', async () => {
    stubFetch({ overall: 'maintenance' });

    const { container } = render(<StatusMini />);
    await settleStatusData(container);

    expect(container.textContent).toContain('检测中');
    expect(container.textContent).not.toContain('undefined');
  });

  it('接口失败（非 2xx）时静默跑到 unknown，不渲染旧数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/public/status')) {
          return { ok: false, status: 502, json: async () => ({}) } as unknown as Response;
        }
        return okJson({});
      }),
    );

    render(<StatusMini />);
    expect(await screen.findByText('检测中')).toBeTruthy();
  });
});

/* ===========================
   global.css 静态断言：全局 teal 覆盖必须消失
   =========================== */

const GLOBAL_CSS = (() => {
  // jsdom 环境里 `import { readFileSync } from 'node:fs'` 会被 Vite 当作浏览器模块
  // externalize，运行期直接抛 "No such built-in module: node:"。这里用 Node 22 的
  // process.getBuiltinModule 取真实内置模块（只读源码，不写文件）。
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const url = process.getBuiltinModule('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, '../../styles/global.css'), 'utf8');
})();

/** 去掉注释，避免注释里的旧写法干扰断言。 */
const CSS = GLOBAL_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

interface SourceRule {
  selector: string;
  body: string;
  start: number;
}

/** 只抓行首的全局链接规则：a / a:hover / .dark a / .dark a:hover。 */
function linkRules(css: string): SourceRule[] {
  const rules: SourceRule[] = [];
  const re = /(?:^|\n)[ \t]*((?:\.dark[ \t]+)?a(?::hover)?)[ \t]*\{([^}]*)\}/g;
  let match = re.exec(css);
  while (match) {
    rules.push({ selector: match[1].trim(), body: match[2], start: match.index });
    match = re.exec(css);
  }
  return rules;
}

/** 返回 @layer <name> { ... } 的起止位置，找不到返回 null。 */
function layerBlock(css: string, name: string): { start: number; end: number } | null {
  const open = css.indexOf(`@layer ${name} {`);
  if (open === -1) return null;
  const braceStart = css.indexOf('{', open);
  let depth = 0;
  for (let i = braceStart; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start: open, end: i };
    }
  }
  return null;
}

describe('global.css · 链接颜色不再全局覆盖组件令牌', () => {
  it('四条全局链接规则只声明 color: inherit，不再写死 teal', () => {
    const rules = linkRules(CSS);
    expect(rules.map((rule) => rule.selector)).toEqual(['a', 'a:hover', '.dark a', '.dark a:hover']);

    for (const rule of rules) {
      const color = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(rule.body);
      expect(color?.[1]?.trim(), `${rule.selector} 应只继承颜色`).toBe('inherit');
      expect(rule.body, `${rule.selector} 仍引用旧 teal 令牌`).not.toMatch(/--color-(?:dark-)?accent/);
    }
  });

  it('保留 transition 与 text-decoration 规则（不靠删规则修颜色）', () => {
    const rules = linkRules(CSS);
    const body = (selector: string) => rules.find((rule) => rule.selector === selector)?.body ?? '';

    expect(body('a')).toContain('transition: color');
    expect(body('a')).toContain('text-decoration: none');
    expect(body('a:hover')).toContain('text-decoration: none');
    expect(body('.dark a:hover')).toContain('text-decoration: none');
  });

  it('链接默认色位于 @layer base 内，组件工具类 text-[var(--sf-on-accent)] 才能生效', () => {
    const base = layerBlock(CSS, 'base');
    expect(base, 'global.css 应存在 @layer base 块').not.toBeNull();

    for (const rule of linkRules(CSS)) {
      expect(rule.start, `${rule.selector} 必须位于 @layer base 内`).toBeGreaterThan(base!.start);
      expect(rule.start, `${rule.selector} 必须位于 @layer base 内`).toBeLessThan(base!.end);
    }
  });

  it('没有任何未分层的 a 颜色规则继续用 teal 覆盖组件（含 hover / .dark）', () => {
    // 旧缺陷的精确签名：行首 a 系列规则里写 color: var(--color-accent*)。
    expect(CSS).not.toMatch(
      /\n[ \t]*(?:\.dark[ \t]+)?a(?::hover)?[ \t]*\{[^}]*color\s*:\s*var\(--color-(?:dark-)?accent/,
    );
  });
});
