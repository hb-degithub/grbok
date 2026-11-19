// @vitest-environment node
// 只读源码文本的静态契约测试；node 环境下才能直接用 node:fs（jsdom 会把 node:fs externalize）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 共享布局（首页「轨道日志」+ Header/SideNav/Dock + 首页嵌套组件）的静态契约。
 *
 * 本轮迁移的目标：
 * - 保留仍然有效的契约：站点配置来源、真实岛屿、公开数据源、无局部令牌覆盖、键盘/导航；
 * - 把旧首页的 `sf-btn-primary`、固定两栏、旧 Dock 尺寸、禁止新视觉形状等断言，
 *   换成首页分区、CTA、岛屿与真实数据源的断言；
 * - 装饰层 / CTA 遮挡 / 横向溢出 / 可访问性等**行为**由
 *   `e2e/sci-fi-site/interactions.spec.ts` 在真实浏览器里验证，不在这里用正则假装。
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relPath: string) => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');
/** 去掉注释再做「不得引入某能力」的断言，避免注释里的说明文字误伤。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const files = {
  index: read('pages/index.astro'),
  hero: read('components/home/HomeHero.astro'),
  scene: read('components/home/OrbitalScene.astro'),
  requestPath: read('components/layout/RequestPath.tsx'),
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

describe('轨道日志首页 · 站点配置与文案来源', () => {
  it('首页文案/开始年份来自 SITE_CONFIG，不写死也不取当前年', () => {
    const hero = files.hero;
    expect(hero).toContain("import { SITE_CONFIG } from '../../config/site'");
    for (const field of ['SITE_CONFIG.name', 'SITE_CONFIG.slogan', 'SITE_CONFIG.description', 'SITE_CONFIG.since']) {
      expect(hero, `Hero 硬编码，未使用 ${field}`).toContain(field);
    }
    expect(hero, 'SINCE 不得使用当前年份动态计算').not.toMatch(/new Date\(\)\.getFullYear\(\)/);
    expect(hero, '站点名应来自 SITE_CONFIG，不再写死').not.toContain('胡巴的博客');

    // index 仍把站点描述交给 BaseLayout，但正文文案已全部下沉到 HomeHero。
    expect(files.index).toContain('description={SITE_CONFIG.description}');
    expect(files.index).not.toContain('胡巴的博客');
  });

  it('首页只保留一个 h1，且 Hero 由 HomeHero 负责', () => {
    expect(files.hero.match(/<h1\b/g)).toHaveLength(1);
    expect(files.hero).toContain('id="home-hero-title"');
    expect(files.index).toContain("import HomeHero from '../components/home/HomeHero.astro'");
    expect(files.index).toContain('<HomeHero />');
    expect(files.index, 'index 不应再手写第二个 h1').not.toMatch(/<h1\b/);
  });

  it('Hero 保留 slogan 尾句与真实描述，不丢旧文案', () => {
    expect(files.hero).toContain('把折腾过的东西写清楚。');
    expect(files.hero).toContain('{SITE_CONFIG.description}');
  });
});

describe('轨道日志首页 · 令牌单一来源', () => {
  it('设计令牌只在 global.css 定义，首页/Hero/装饰层不局部覆盖', () => {
    for (const [name, src] of [
      ['index.astro', files.index],
      ['HomeHero.astro', files.hero],
      ['OrbitalScene.astro', files.scene],
    ] as const) {
      expect(src, `${name} 不应出现局部 :root 令牌块`).not.toMatch(/^\s*:root\s*\{/m);
      expect(src, `${name} 不应重复声明 --sf-* 令牌`).not.toMatch(/^\s*--sf-[a-z0-9-]+\s*:/m);
      expect(src, `${name} 不应再写局部 .dark 令牌块`).not.toMatch(/^\s*\.dark\s*\{/m);
    }
  });
});

describe('轨道日志首页 · CTA 与分区构图', () => {
  it('主 CTA「浏览全部文章」指向 /posts，并使用 on-accent 文字色', () => {
    const src = files.hero;
    expect(src).toContain('浏览全部文章');
    expect(src).toMatch(/<a\s+href="\/posts"[^>]*class="orbital-hero__cta"/);
    expect(src, '强调色背景上禁用 text-white').not.toContain('text-white');
    expect(src).toContain('var(--sf-on-accent)');
  });

  it('保留 /about CTA 与「关于这个站点」入口', () => {
    expect(files.hero).toMatch(/<a\s+href="\/about"[^>]*class="orbital-hero__cta orbital-hero__cta--ghost"/);
    expect(files.hero).toContain('关于这个站点');
  });

  it('首页用共享容器 + SectionHeading 建立分区，而不是旧的固定两栏', () => {
    expect(files.index).toContain("import SectionHeading from '../components/layout/SectionHeading.astro'");
    expect(files.index.match(/<SectionHeading\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(files.index).toContain('orbital-shell');
    expect(files.index).toContain('orbital-panel');

    for (const [sectionId, titleId] of [
      ['latest', 'latest-title'],
      ['community', 'community-title'],
      ['connect', 'connect-title'],
      ['status', 'status-title'],
    ] as const) {
      expect(files.index, `缺少分区 #${sectionId}`).toContain(`id="${sectionId}"`);
      expect(files.index, `分区 #${sectionId} 缺少 aria-labelledby`).toContain(
        `aria-labelledby="${titleId}"`,
      );
      expect(files.index, `SectionHeading 缺少唯一 id=${titleId}`).toContain(`id="${titleId}"`);
    }

    expect(files.index, '不应回到旧的等宽两栏').not.toContain('lg:grid-cols-2');
    expect(files.index, '应使用非对称分栏').toMatch(/lg:grid-cols-\[[^\]]+fr[^\]]*\]/);
  });

  it('装饰层不进入可访问树、不拦截指针、减少动效时静止', () => {
    const scene = files.scene;
    const sceneCode = stripComments(scene);
    expect(scene).toContain('data-orbital-decoration="true"');
    expect(scene).toContain('aria-hidden="true"');
    expect(scene).toContain('pointer-events: none');
    expect(scene).toContain('prefers-reduced-motion: no-preference');
    // 装饰层不得引入业务数据源或外部资源。
    expect(sceneCode).not.toContain('fetch(');
    expect(sceneCode).not.toContain('SITE_CONFIG');
    expect(sceneCode).not.toContain("from 'react");
    expect(scene).not.toMatch(/<img\b/);
    expect(scene).not.toMatch(/https?:\/\//);
    expect(scene, '装饰层不应输出毫秒等伪数据').not.toMatch(/\bms\b/);
    expect(scene, '装饰层不应包含可读文本节点').not.toContain('<text');
  });

  it('Hero 在移动端先文案、后真实链路（DOM 顺序）', () => {
    const src = files.hero;
    const title = src.indexOf('home-hero-title');
    const telemetry = src.indexOf('orbital-hero__telemetry');
    const requestPath = src.indexOf('<RequestPath');
    expect(title).toBeGreaterThan(-1);
    expect(telemetry).toBeGreaterThan(title);
    expect(requestPath).toBeGreaterThan(telemetry);
  });
});

describe('轨道日志首页 · 真实岛屿与数据源', () => {
  it('保留全部业务岛屿与 client:visible 水合', () => {
    const src = files.index;
    for (const island of [
      'PostList',
      'HomeSideNav',
      'StatusMini',
      'HomeAuthQuickEntry',
      'HotArticles',
      'RecentComments',
      'ProfileCard',
      'FriendLinks',
      'CountUp',
    ]) {
      expect(src, `首页丢失交互岛 ${island}`).toMatch(new RegExp(`<${island}\\b[^>]*client:visible`));
    }
    expect(src).toContain("import PostList from '../components/posts/PostList'");
    expect(src).toContain("import HotArticles from '../components/sidebar/HotArticles'");
    expect(src).toContain("import RecentComments from '../components/sidebar/RecentComments'");
    expect(src).toContain("import ProfileCard from '../components/sidebar/ProfileCard'");
    expect(src).toContain("import FriendLinks from '../components/sidebar/FriendLinks'");
  });

  it('统计仍由 index.astro SSR 取数，CountUp 仍在首页状态区块', () => {
    const src = files.index;
    expect(src, '统计仍来自 PocketBase 计数').toContain('fetchCount');
    expect(src).toContain("fetchCount('posts', 'status = \"published\"')");
    expect(src).toContain("fetchCount('tags')");
    expect(src).toContain('to={postsCount}');
    expect(src).toContain('to={tagsCount}');
    expect(src).toContain('已发布文章');
    expect(src).toContain('内容标签');
    expect(files.hero, 'Hero 不包含计数 props').not.toMatch(/postsCount|tagsCount/);
  });

  it('RequestPath 以真实链路岛挂载，并保留 figcaption 与未采集说明', () => {
    expect(files.hero).toContain("import RequestPath from '../layout/RequestPath'");
    expect(files.hero).toMatch(/<RequestPath\s+client:visible\s*\/>/);
    expect(files.hero).toContain('真实请求链路');
    expect(files.hero).toContain('未采集');
    expect(files.hero).toContain('不显示估算值');
  });

  it('RequestPath 消费共享公开状态，不再自行 fetch / 轮询', () => {
    const src = files.requestPath;
    const srcCode = stripComments(src);
    expect(src).toContain("import { usePublicStatus } from '../../hooks/usePublicStatus'");
    expect(src).toContain('usePublicStatus()');
    expect(srcCode, '组件不应自行请求接口').not.toContain('fetch(');
    expect(srcCode, '组件不应自行建轮询').not.toContain('setInterval');
    expect(src).toContain('aria-label="真实请求链路"');
    expect(src).toContain('未采集');
    expect(src).toContain('无逐跳探测');
    // 不能写死毫秒数（真实数值只能来自接口/浏览器实测）。
    expect(src).not.toMatch(/\d+\s*ms/);
  });

  it('不恢复旧装饰组件', () => {
    for (const legacy of ['AnimatedList', 'Carousel', 'MagicBento', 'ParticleField', 'GlowCard']) {
      expect(files.index, `首页不应恢复旧装饰 ${legacy}`).not.toContain(legacy);
      expect(files.hero, `Hero 不应恢复旧装饰 ${legacy}`).not.toContain(legacy);
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

  it('内页共享区块包装类仍在，首页复用新的 orbital-panel', () => {
    expect(files.globalCss).toContain('.sf-block');
    expect(files.globalCss).toContain('.orbital-panel');
    expect(files.index, '首页面板应复用共享包装类').toContain('orbital-panel');
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

  it('Header 保留 Dock 参数接线、移动菜单与真实路由（不锁死像素尺寸）', () => {
    const src = files.header;
    for (const token of [
      'magnification={',
      'baseItemSize={',
      'distance={',
      'panelHeight={',
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

  it('Header/SideNav/首页嵌套组件与 Hero/装饰层不再引入玻璃、重阴影与大圆角', () => {
    for (const [name, src] of [
      ['Header.tsx', files.header],
      ['SideNav.tsx', files.sideNav],
      ['HomeSideNav.tsx', files.homeSideNav],
      ['StatusMini.tsx', files.statusMini],
      ['HomeAuthQuickEntry.tsx', files.authEntry],
      ['HotArticles.tsx', files.hotArticles],
      ['RecentComments.tsx', files.recentComments],
      ['index.astro', files.index],
      ['HomeHero.astro', files.hero],
      ['OrbitalScene.astro', files.scene],
      ['RequestPath.tsx', files.requestPath],
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
