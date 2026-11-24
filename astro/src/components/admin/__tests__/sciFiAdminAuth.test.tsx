// @vitest-environment node
// 纯源码静态断言，不需要 DOM；jsdom 环境会把 node:fs 外部化为浏览器模块。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 后台 + 登录页「科幻简约」静态断言（纯样式改动，无行为变更）。
 *
 * 背景：全站科幻简约改造只动样式（docs/superpowers/specs/2026-11-17-sci-fi-site-wide-design.md），
 * 业务逻辑、接口、鉴权、数据流保持不动，因此这里用源码静态断言锁定设计契约，
 * 而不是渲染快照：
 *   - 三个组件必须使用 global.css 的 `--sf-*` 设计令牌（浅色 #f1f3f5 画布、
 *     #16191d 石墨、唯一强调 #0b6d76；暗色由 `.dark` 令牌整体切换）；
 *   - 去掉玻璃拟态 / 大面积阴影 / 彩色渐变 / 冷暖撞色（zinc-sky-blue 系）；
 *   - 后台导航项、分组、权限与交互（折叠、抽屉、Esc、退出）全部保留：
 *     原 16 项一项不删，另补齐 features / insights / versions / gallery /
 *     guestbook 这 5 个真实页面，且每项 href 都对应真实 Astro 页面、页面
 *     requiredRole 与侧栏门槛一致；
 *   - 顶栏把「本页要求」（页面门槛）与真实账号角色徽标分开，徽标只读
 *     useAdminAuth().user，不改 AdminGuard 鉴权；
 *   - StatsCard 6 个字段接口不变；
 *   - AuthPage 三个 tab 与三个表单、关键文案与 a11y 属性不变。
 */

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relPath: string) => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

const files = {
  'AdminSidebar.tsx': read('components/admin/AdminSidebar.tsx'),
  'StatsCard.tsx': read('components/admin/StatsCard.tsx'),
  'AuthPage.tsx': read('components/auth/AuthPage.tsx'),
  'AuthTabs.tsx': read('components/auth/AuthTabs.tsx'),
} as const;

const ALL = Object.values(files).join('\n');

/** 设计令牌层（global.css 提供，深色走 .dark 覆写）。 */
const SF_TOKENS = [
  '--sf-canvas',
  '--sf-surface',
  '--sf-ink',
  '--sf-ink-2',
  '--sf-ink-3',
  '--sf-line',
  '--sf-line-strong',
  '--sf-line-soft',
  '--sf-line-control',
  '--sf-accent',
] as const;

/** 改造前的装饰：玻璃、重阴影、渐变、冷暖撞色调色板。 */
const BANNED_PATTERNS: Array<[string, RegExp]> = [
  ['玻璃拟态 backdrop-blur', /backdrop-blur/],
  ['阴影工具类 shadow-(xs|sm|md|lg|xl|2xl)', /\bshadow-(?:xs|sm|md|lg|xl|2xl)\b/],
  ['任意值阴影 shadow-[', /shadow-\[/],
  ['渐变背景 bg-gradient-to-', /bg-gradient-to-/],
  ['zinc/sky/blue/indigo/violet/purple 撞色调色板', /\b(?:bg|text|border|from|to|ring)-(?:zinc|sky|blue|indigo|violet|purple)-/],
  ['半透明白玻璃层 bg-white/xx', /bg-white\/\d{1,3}/],
  ['大圆角 rounded-(md|lg|xl|2xl|3xl)', /\brounded-(?:md|lg|xl|2xl|3xl)\b/],
];

/**
 * 侧栏导航契约：既有 16 项（顺序、文案、分组、门槛不变）+ 5 个此前有页面
 * 却没进侧栏的真实后台页（features / insights / versions / gallery /
 * guestbook）。role 必须与对应页面 AdminLayout 的 requiredRole 一致。
 */
type AdminNavEntry = {
  href: string;
  label: string;
  hint: string;
  section: string;
  role: 'author' | 'admin' | 'super_admin';
};

const ADMIN_NAV: AdminNavEntry[] = [
  { href: '/admin', label: '仪表盘', hint: '概览', section: '主控台', role: 'author' },
  { href: '/admin/stats', label: '统计', hint: '访问', section: '主控台', role: 'author' },
  { href: '/admin/insights', label: '数据洞察', hint: '洞察', section: '主控台', role: 'admin' },
  { href: '/admin/monitor', label: '监控', hint: '运行状态', section: '主控台', role: 'admin' },
  { href: '/admin/posts', label: '文章', hint: '撰写', section: '内容', role: 'author' },
  { href: '/admin/comments', label: '评论', hint: '审核', section: '内容', role: 'admin' },
  { href: '/admin/tags', label: '标签', hint: '分类', section: '内容', role: 'author' },
  // 媒体库 = 素材仓库（文章封面/正文插图）；相册管理 = /gallery 对外照片墙。
  { href: '/admin/media', label: '媒体库', hint: '素材', section: '内容', role: 'author' },
  { href: '/admin/gallery', label: '相册管理', hint: '展示', section: '内容', role: 'author' },
  { href: '/admin/friend-links', label: '友链', hint: '外链', section: '内容', role: 'super_admin' },
  { href: '/admin/guestbook', label: '留言治理', hint: '留言', section: '内容', role: 'super_admin' },
  { href: '/admin/users', label: '用户', hint: '权限', section: '系统', role: 'super_admin' },
  { href: '/admin/announcements', label: '公告', hint: '广播', section: '系统', role: 'super_admin' },
  { href: '/admin/settings', label: '设置', hint: '站点', section: '系统', role: 'super_admin' },
  { href: '/admin/security', label: '安全', hint: '审计', section: '系统', role: 'super_admin' },
  { href: '/admin/mail', label: '邮件中心', hint: '邮件', section: '系统', role: 'super_admin' },
  { href: '/admin/cache', label: '缓存管理', hint: 'ESA', section: '系统', role: 'super_admin' },
  { href: '/admin/audit', label: '审计日志', hint: '操作记录', section: '系统', role: 'super_admin' },
  { href: '/admin/ai', label: 'AI 助手', hint: 'AI', section: '系统', role: 'super_admin' },
  { href: '/admin/features', label: '功能开关', hint: '开关', section: '系统', role: 'admin' },
  { href: '/admin/versions', label: '版本历史', hint: '版本', section: '系统', role: 'admin' },
];

describe('科幻简约 · 后台组件与登录页设计契约', () => {
  it('三个组件都走 --sf-* 令牌（画布/表面/石墨/冷灰线/唯一强调）', () => {
    for (const [name, src] of Object.entries(files)) {
      expect(src, `${name} 必须引用全局科幻设计令牌`).toContain('var(--sf-');
    }

    for (const token of SF_TOKENS) {
      expect(ALL, `缺少令牌 var(${token})`).toContain(`var(${token})`);
    }

    // 令牌值只应存在于 global.css；组件内不得再写死色值或双主题色。
    expect(ALL, '组件内不应写死十六进制色值，应使用 --sf-* 令牌').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(ALL, '深浅主题由 .dark 令牌切换，组件内不应再写 dark: 调色板').not.toMatch(/dark:(?:bg|text|border)-/);
  });

  it('去掉玻璃拟态、重阴影、渐变与撞色调色板', () => {
    for (const [name, src] of Object.entries(files)) {
      for (const [label, pattern] of BANNED_PATTERNS) {
        expect(src, `${name} 仍包含${label}`).not.toMatch(pattern);
      }
    }
  });

  it('AdminSidebar 覆盖 21 个导航项、分组与文案（原 16 项全部保留）', () => {
    expect(ADMIN_NAV).toHaveLength(21);

    const src = files['AdminSidebar.tsx'];
    // navItems 每项都是单行对象字面量：先锁总数，再逐项锁字段，避免
    // `toContain('href')` 这种跨项误判（同一 href 出现在别处也能通过）。
    const itemLines = src.split('\n').filter((line) => /^\s*\{ href: '\/admin/.test(line));
    expect(itemLines, '导航项数量必须与契约一致（原 16 项 + 新增 5 项）').toHaveLength(21);

    for (const { href, label, hint, section, role } of ADMIN_NAV) {
      const line = itemLines.find((item) => item.includes(`href: '${href}'`));
      expect(line, `导航 href 丢失：${href}`).toBeTruthy();
      expect(line, `导航 label 丢失：${label}`).toContain(`label: '${label}'`);
      expect(line, `导航 hint 丢失：${hint}`).toContain(`hint: '${hint}'`);
      expect(line, `导航分组丢失：${section}`).toContain(`section: '${section}'`);
      expect(line, `${href} 权限门槛应为 ${role}，不得放宽/收紧`).toContain(`requiredRole: '${role}'`);
    }

    // 两个易混入口的说明必须写在导航项里（仅展开态展示，但文案在源码中锁定）。
    expect(src).toContain('素材仓库：文章封面、正文插图');
    expect(src).toContain('对外展示的照片墙');

    // 权限门槛分布：author 6 项、admin 5 项、super_admin 10 项
    // （原 5/2/9，仅新增页面各自带来 +1/+3/+1）。
    const count = (re: RegExp) => (src.match(re) ?? []).length;
    expect(count(/requiredRole: 'author'/g)).toBe(6);
    expect(count(/requiredRole: 'admin'/g)).toBe(5);
    expect(count(/requiredRole: 'super_admin'/g)).toBe(10);

    // 角色标签与权限过滤保留。
    for (const roleLabel of ['普通用户', '作者', '管理员', '超级管理员']) {
      expect(src).toContain(roleLabel);
    }
    expect(src).toContain('hasPermission(item.requiredRole)');
    expect(src).toContain('aria-current={active ?');
  });

  it('每个导航项都指向真实存在的 Astro 页面，且页面门槛与导航一致', () => {
    // 导航覆盖 ≠ 路由存在：逐项在两处候选里找真实页面文件，
    // 再比对页面 AdminLayout 的 requiredRole（缺省即 author）。
    for (const { href, role } of ADMIN_NAV) {
      const candidates = [`pages${href}.astro`, `pages${href}/index.astro`];
      const pagePath = candidates.map((rel) => resolve(SRC_ROOT, rel)).find((abs) => existsSync(abs));
      expect(pagePath, `路由文件不存在：${href}`).toBeTruthy();

      const page = readFileSync(pagePath!, 'utf8');
      const layoutTag = page.match(/<AdminLayout[^>]*>/s)?.[0] ?? '';
      expect(layoutTag, `${href} 未使用 AdminLayout`).toContain('<AdminLayout');
      const declaredRole = layoutTag.match(/requiredRole="([^"]+)"/)?.[1] ?? 'author';
      expect(declaredRole, `${href} 页面 requiredRole 与侧栏门槛不一致`).toBe(role);
    }
  });

  it('顶栏把「本页要求」与真实账号角色分开，不再把页面门槛写成当前权限', () => {
    const layout = read('layouts/AdminLayout.astro');
    expect(layout).toContain('本页要求：{requiredRoleLabel[requiredRole]}');
    expect(layout, '「当前权限」会让人误读成账号权限，已由「本页要求」+ 真实角色徽标替代').not.toContain('当前权限');
    expect(layout).toContain("import AdminRoleBadge from '../components/admin/AdminRoleBadge';");
    expect(layout).toContain('<AdminRoleBadge client:only="react" />');

    // 徽标只读真实登录用户（useAdminAuth().user），不参与鉴权/跳转。
    const badge = read('components/admin/AdminRoleBadge.tsx');
    for (const token of [
      'useAdminAuth()',
      'user',
      'role',
      'data-role={role}',
      '普通用户',
      '作者',
      '管理员',
      '超级管理员',
      '角色同步中',
      '未识别角色',
      'var(--sf-accent)',
    ]) {
      expect(badge, `AdminRoleBadge 契约丢失：${token}`).toContain(token);
    }
    expect(badge).toMatch(/export default function AdminRoleBadge/);
    expect(badge, '角色徽标不得承担鉴权/跳转').not.toMatch(/window\.location|redirect|from '\.\.\/AdminGuard'/i);
    expect(badge, '徽标不应写死色值').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('AdminSidebar 保留折叠、抽屉、Esc 关闭、焦点与退出登录交互', () => {
    for (const token of [
      'admin-sidebar-collapsed',
      'localStorage.setItem',
      '--admin-sidebar-width',
      'Escape',
      'aria-modal="true"',
      'aria-expanded={drawerOpen}',
      'aria-controls="admin-mobile-sidebar"',
      '打开后台菜单',
      '关闭后台菜单',
      '切换侧边栏',
      '退出登录',
      'useAdminLogout',
      'logout()',
      '{ isDesktop }',
      'preventScroll: true',
      "document.body.style.overflow = 'hidden'",
      'getScrollbarWidth',
    ]) {
      expect(files['AdminSidebar.tsx'], `AdminSidebar 交互契约丢失：${token}`).toContain(token);
    }
  });

  it('StatsCard 保留 6 个字段接口、进度裁剪与单一强调色', () => {
    const src = files['StatsCard.tsx'];
    for (const field of [
      'label: string;',
      'value: number | string;',
      'icon: string;',
      "color: 'cyan' | 'amber' | 'emerald' | 'red';",
      'trend?: string;',
      'progress?: number;',
    ]) {
      expect(src, `StatsCard 字段丢失：${field}`).toContain(field);
    }

    expect(src).toContain('safeProgress');
    expect(src).toMatch(/Math\.max\(0, Math\.min\(100/);
    expect(src, '保留 motion 数值/进度动效').toContain('motion.div');
    expect(src, '保留语义色参数（视觉已统一为强调色）').toContain('data-tone={color}');
    expect(src, '进度条使用唯一强调色').toContain('var(--sf-accent)');
  });

  it('AuthPage 保留三个 tab、三个表单与全部关键文案', () => {
    const src = files['AuthPage.tsx'];

    for (const token of [
      'type AuthMode',
      "'otp'",
      "'register'",
      'aria-labelledby="auth-heading"',
      'aria-labelledby={tabLabelId}',
      "from './AuthTabs'",
      "from './MagicLinkForm'",
      "from './PasswordLoginForm'",
      "from './RegisterForm'",
      '<MagicLinkForm key="otp" />',
      '<RegisterForm key="register" />',
      '<PasswordLoginForm key=',
      'AnimatePresence mode="wait"',
      '密码登录',
      '验证码',
      '注册',
      '欢迎来到博客',
      '分享技术、思考与生活',
      '正在扫描用户',
      '返回首页',
      '需要配置 PocketBase 邮件服务后才能使用验证码登录',
    ]) {
      expect(src, `AuthPage 契约丢失：${token}`).toContain(token);
    }

    // tablist/tab 语义已抽到共享 AuthTabs：断言随组件迁移，不削弱契约。
    const tabs = files['AuthTabs.tsx'];
    for (const token of [
      'role="tablist"',
      'role="tab"',
      'aria-selected={selected}',
      'aria-controls={authPanelId(item.id, idPrefix)}',
      'tabIndex={selected ? 0 : -1}',
      "case 'ArrowRight'",
      "case 'ArrowLeft'",
      "case 'Home'",
      "case 'End'",
    ]) {
      expect(tabs, `AuthTabs 契约丢失：${token}`).toContain(token);
    }

    expect(src, 'AuthPage 必须默认导出').toMatch(/export default function AuthPage/);
    expect(tabs, 'AuthTabs 必须默认导出').toMatch(/export default function AuthTabs/);
  });

  it('登录页改用冷灰细网格背景，不再挂载 3D 扫描装饰', () => {
    const src = files['AuthPage.tsx'];
    expect(src).not.toContain('LoginGridScanBackground');
    expect(src).toContain('linear-gradient');
    expect(src).toContain('32px 32px');
    expect(src).toContain('pointer-events-none');
  });

  it('三个组件均默认导出（禁止命名导出）', () => {
    expect(files['AdminSidebar.tsx']).toMatch(/export default function AdminSidebar/);
    expect(files['StatsCard.tsx']).toMatch(/export default function StatsCard/);
    expect(files['AuthPage.tsx']).toMatch(/export default function AuthPage/);
    expect(ALL).not.toMatch(/export (?:const|function) (?:AdminSidebar|StatsCard|AuthPage)\b/);
  });
});
