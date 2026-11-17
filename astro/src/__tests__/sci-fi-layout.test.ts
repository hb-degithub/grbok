// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境下才能直接用 node:fs（jsdom 会把 node:fs externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 共享布局（首页 + Header/SideNav/Dock + 首页嵌套旧组件）科幻简约修复的静态契约。
 *
 * 这一层只锁定「设计令牌 + 真实内容与数据源没有在改造中被删掉」这类文本契约；
 * 菜单 Esc/焦点循环、Dock 键盘触发等交互行为由同批次的 jsdom 测试覆盖，
 * 不在这里用正则假装验证交互。
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath: string) => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

const files = {
  index: read('pages/index.astro'),
  globalCss: read('styles/global.css'),
  header: read('components/layout/Header.tsx'),
  sideNav: read('components/layout/SideNav.tsx'),
  homeSideNav: read('components/sidebar/HomeSideNav.tsx'),
  statusMini: read('components/sidebar/StatusMini.tsx'),
  authEntry: read('components/auth/HomeAuthQuickEntry.tsx'),
  hotArticles: read('components/sidebar/HotArticles.tsx'),
  recentComments: read('components/sidebar/RecentComments.tsx'),
  dockCss: read('components/reactbits/Dock.css'),
  dockJsx: read('components/reactbits/Dock.jsx'),
} as const;

/** 改造前的冷暖撞色调色板：改造后只允许石墨 + 冷灰 + 单一青色令牌。 */
const LEGACY_PALETTE =
  /\b(?:bg|text|border|from|via|to|ring|outline|divide|placeholder|fill|stroke|shadow)-(?:zinc|neutral|stone|slate|gray|grey|teal|cyan|indigo|violet|purple|emerald|sky|blue)-\d{2,3}/;

/** 迁移到统一令牌的视觉/结构约束。 */
const BANNED_VISUALS: Array<[label: string, pattern: RegExp]> = [
  ['玻璃拟态 backdrop-blur', /backdrop-blur/],
  ['重阴影 shadow-(xs|sm|md|lg|xl|2xl)', /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/],
  ['任意值阴影 shadow-[', /shadow-\[/],
  ['大面积渐变 bg-gradient-to-', /bg-gradient-to-/],
  ['大圆角 rounded-(md|lg|xl|2xl|3xl)', /\brounded-(?:md|lg|xl|2xl|3xl)\b/],
  ['深浅主题调色板覆写 dark:(bg|text|border)-', /dark:(?:bg|text|border)-/],
];

describe('共享布局科幻改造 · 首页', () => {
  it('首页文案/开始年份来自 SITE_CONFIG，不写死也不取当前年', () => {
    const src = files.index;
    expect(src).toContain("import { SITE_CONFIG } from '../config/site'");
    for (const field of ['SITE_CONFIG.name', 'SITE_CONFIG.slogan', 'SITE_CONFIG.description', 'SITE_CONFIG.since']) {
      expect(src, `首页硬编码，未使用 ${field}`).toContain(field);
    }
    expect(src, 'SINCE 不得使用当前年份动态计算').not.toMatch(/new Date\(\)\.getFullYear\(\)/);
    expect(src, '站点名应来自 SITE_CONFIG，不再写死').not.toContain('胡巴的博客');
  });

  it('设计令牌只在 global.css 定义，首页不再局部覆盖 :root/.dark', () => {
    const src = files.index;
    expect(src, '首页不应再出现局部 :root 令牌块').not.toMatch(/^\s*:root\s*\{/m);
    expect(src, '首页不应重复声明 --sf-* 令牌').not.toMatch(/^\s*--sf-[a-z0-9-]+\s*:/m);
    expect(src, '首页不应再写局部 .dark 令牌块').not.toMatch(/^\s*\.dark\s*\{/m);
  });

  it('暗色细网格走全局作用域，不会被 Astro scoped 样式裁掉', () => {
    expect(files.index, '暗色网格必须使用 :global(.dark) 前缀').toContain(':global(.dark) .sf-grid-bg');
    expect(files.index, '局部 .dark .sf-grid-bg 会被加上 scope 属性而永不命中').not.toMatch(
      /^\s*\.dark \.sf-grid-bg/m,
    );
  });

  it('主 CTA「浏览全部文章」指向 /posts，并使用 on-accent 文字色', () => {
    const src = files.index;
    expect(src).toContain('浏览全部文章');
    expect(src).toMatch(/<a\s+href="\/posts"[^>]*class="sf-btn-primary/);
    expect(src, '强调色背景上禁用 text-white').not.toContain('text-white');
    expect(src).toContain('text-[var(--sf-on-accent)]');
  });

  it('保留真实交互岛与数据源（没有为了排版静默删内容）', () => {
    const src = files.index;
    for (const island of ['PostList', 'HomeSideNav', 'StatusMini', 'HomeAuthQuickEntry', 'HotArticles', 'RecentComments']) {
      expect(src, `首页丢失交互岛 ${island}`).toMatch(new RegExp(`<${island}\\b[^>]*client:visible`));
    }
    expect(src).toContain("import HotArticles from '../components/sidebar/HotArticles'");
    expect(src).toContain("import RecentComments from '../components/sidebar/RecentComments'");
    expect(src, '统计仍来自 PocketBase 计数').toContain('fetchCount');
    expect(src, '统计动效组件保留').toContain('CountUp');
  });

  it('热榜/最近评论补回为两栏网格，不恢复旧侧栏与轮播', () => {
    const src = files.index;
    expect(src, '补回区应使用两栏网格').toMatch(/lg:grid-cols-2/);
    const gridIndex = src.indexOf('lg:grid-cols-2');
    expect(src.indexOf('<HotArticles'), 'HotArticles 应位于两栏网格内').toBeGreaterThan(gridIndex);
    expect(src.indexOf('<RecentComments'), 'RecentComments 应位于两栏网格内').toBeGreaterThan(gridIndex);
    for (const legacy of ['AnimatedList', 'Carousel', 'MagicBento', 'ParticleField', 'GlowCard', 'ProfileCard']) {
      expect(src, `首页不应恢复旧装饰 ${legacy}`).not.toContain(legacy);
    }
  });
});

describe('共享布局科幻改造 · global.css 单一来源', () => {
  it('深浅两套 --sf-* 令牌各只声明一次', () => {
    const count = (needle: string) => files.globalCss.split(needle).length - 1;
    for (const token of ['--sf-canvas:', '--sf-surface:', '--sf-ink:', '--sf-accent:', '--sf-line:']) {
      expect(count(token), `${token} 应仅浅色/暗色各一份`).toBe(2);
    }
  });

  it('新增 --sf-on-accent（浅色 #fff / 暗色 #16191d）供强调色背景使用', () => {
    expect(files.globalCss).toMatch(/--sf-on-accent:\s*#fff\b/i);
    expect(files.globalCss).toMatch(/--sf-on-accent:\s*#16191d\b/i);
  });

  it('body 与 .dark body 统一使用 --sf-canvas / --sf-ink', () => {
    expect(files.globalCss).toMatch(
      /body\s*\{[^}]*background-color:\s*var\(--sf-canvas\)[^}]*color:\s*var\(--sf-ink\)/,
    );
    expect(files.globalCss).toMatch(
      /\.dark body\s*\{[^}]*background-color:\s*var\(--sf-canvas\)[^}]*color:\s*var\(--sf-ink\)/,
    );
  });

  it('提供共享区块包装类，供首页子组件保持主题一致', () => {
    expect(files.globalCss).toContain('.sf-block');
    expect(files.index, '首页新 section 应复用共享包装类').toContain('sf-block');
  });
});

describe('共享布局科幻改造 · Header / SideNav', () => {
  it('Header 头像等强调色背景使用 on-accent，dropdown 无旧 zinc 残余', () => {
    const src = files.header;
    expect(src).not.toContain('text-white');
    expect(src).toContain('text-[var(--sf-on-accent)]');
    expect(src, 'Header 仍含旧调色板').not.toMatch(LEGACY_PALETTE);
    expect(src, '主题/更多下拉的描述文字仍用旧 zinc').not.toMatch(/text-zinc-/);
  });

  it('Header 保留 Dock 放大参数、移动菜单与真实路由', () => {
    const src = files.header;
    for (const token of [
      'magnification={62}',
      'baseItemSize={46}',
      'distance={180}',
      'panelHeight={64}',
      '打开导航菜单',
      'aria-expanded={sideNavOpen}',
      "href: '/posts'",
    ]) {
      expect(src, `Header 契约丢失：${token}`).toContain(token);
    }
  });

  it('SideNav 迁移到统一令牌，保留 dialog/Esc/焦点归还/菜单项', () => {
    const src = files.sideNav;
    expect(src).toContain('var(--sf-');
    expect(src).not.toMatch(LEGACY_PALETTE);
    for (const token of [
      'role="dialog"',
      'aria-modal="true"',
      'aria-label="移动端侧边导航"',
      'Escape',
      'previousActiveElement',
      'handleDrawerKeyDown',
      'preventScroll: true',
      "document.body.style.overflow = 'hidden'",
      '关闭侧边导航',
      'canAccessAdmin',
      "href: '/subscribe'",
      'text-[var(--sf-on-accent)]',
    ]) {
      expect(src, `SideNav 契约丢失：${token}`).toContain(token);
    }
    expect(src).toMatch(/export default function SideNav/);
  });

  it('Header/SideNav/首页嵌套组件不再引入玻璃、重阴影与大圆角', () => {
    for (const [name, src] of [
      ['Header.tsx', files.header],
      ['SideNav.tsx', files.sideNav],
      ['HomeSideNav.tsx', files.homeSideNav],
      ['StatusMini.tsx', files.statusMini],
      ['HomeAuthQuickEntry.tsx', files.authEntry],
      ['HotArticles.tsx', files.hotArticles],
      ['RecentComments.tsx', files.recentComments],
      ['index.astro', files.index],
    ] as const) {
      for (const [label, pattern] of BANNED_VISUALS) {
        expect(src, `${name} 仍包含${label}`).not.toMatch(pattern);
      }
    }
  });
});

describe('共享布局科幻改造 · 首页嵌套旧组件', () => {
  it('HomeSideNav 保留 scrollspy 与滑动指示，只换视觉令牌', () => {
    const src = files.homeSideNav;
    expect(src).toContain('var(--sf-');
    expect(src).not.toMatch(LEGACY_PALETTE);
    for (const token of [
      "document.getElementById('latest')",
      'requestAnimationFrame',
      'layoutId="home-side-nav-pill"',
      'MotionConfig reducedMotion="user"',
      'aria-label="分区导航"',
      "href: '/posts'",
      "href: '/tags'",
      'text-[var(--sf-on-accent)]',
    ]) {
      expect(src, `HomeSideNav 契约丢失：${token}`).toContain(token);
    }
    expect(src).toMatch(/export default function HomeSideNav/);
  });

  it('StatusMini 保留真实状态接口与三态文案，去掉发光阴影', () => {
    const src = files.statusMini;
    expect(src).toContain('var(--sf-');
    expect(src).not.toMatch(LEGACY_PALETTE);
    for (const token of [
      "'/api/public/status'",
      'api/public/ping',
      'setInterval',
      '30_000',
      'aria-label="查看完整运行状态页"',
      '运行正常',
      '部分异常',
      '检测中',
      '24h 延迟',
      '24h 可用率',
      '你的延迟',
      '24h 攻击拦截',
    ]) {
      expect(src, `StatusMini 契约丢失：${token}`).toContain(token);
    }
    expect(src).not.toMatch(/shadow-\[/);
    expect(src).toMatch(/export default function StatusMini/);
  });

  it('HomeAuthQuickEntry 保留登录/注销/角色门禁与真实状态', () => {
    const src = files.authEntry;
    expect(src).toContain('var(--sf-');
    expect(src).not.toMatch(LEGACY_PALETTE);
    for (const token of [
      'useAuthStatus',
      'canAccessAdmin',
      "logout('/')",
      'href="/login"',
      'href="/admin"',
      'ROLE_LABELS',
      '登录 / 注册',
      '管理后台',
      '退出登录',
    ]) {
      expect(src, `HomeAuthQuickEntry 业务契约丢失：${token}`).toContain(token);
    }
    expect(src).not.toContain('text-white');
    expect(src).toMatch(/export default function HomeAuthQuickEntry/);
  });

  it('热门文章与最近评论保留真实 hook/数据，去掉 AnimatedList 与重动效', () => {
    const hot = files.hotArticles;
    expect(hot).toContain('useHotPosts(5)');
    expect(hot).not.toContain("from '../reactbits/AnimatedList'");
    expect(hot).not.toContain('<AnimatedList');
    expect(hot).not.toContain('framer-motion');
    expect(hot).toContain('/posts/${post.slug}');
    expect(hot).toContain('暂无热门文章');
    expect(hot).toContain('post.views');
    expect(hot).toContain('padStart(2');
    expect(hot).toContain('var(--sf-');

    const recent = files.recentComments;
    expect(recent).toContain('useRecentComments(5)');
    expect(recent).not.toContain("from '../reactbits/AnimatedList'");
    expect(recent).not.toContain('<AnimatedList');
    expect(recent).not.toContain('framer-motion');
    expect(recent).toContain('sanitizeText');
    expect(recent).toContain('暂无评论');
    expect(recent).toContain('comment.author_name');
    expect(recent).toContain('padStart(2');
    expect(recent).toContain('var(--sf-');
  });
});

describe('共享布局科幻改造 · Dock 视觉层', () => {
  it('Dock.css 只用 --sf-* 实色/细线/小圆角，无玻璃与重阴影', () => {
    const css = files.dockCss;
    expect(css).toContain('var(--sf-');
    expect(css).not.toContain('backdrop-filter');
    expect(css, '不得引入重阴影').not.toContain('box-shadow');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain('rgba(');
    expect(css).toContain('border-radius: 4px');
    expect(css).toContain('.dock-item--active');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('Dock.jsx 交互接口未被改动（放大/键盘/可达性）', () => {
    const jsx = files.dockJsx;
    for (const token of [
      'magnification',
      'baseItemSize',
      'handleKeyDown',
      'useReducedMotion',
      "aria-label={label}",
      'aria-haspopup={hasPopup}',
      'role="toolbar"',
      'dock-item--active',
    ]) {
      expect(jsx, `Dock 交互契约丢失：${token}`).toContain(token);
    }
  });
});
