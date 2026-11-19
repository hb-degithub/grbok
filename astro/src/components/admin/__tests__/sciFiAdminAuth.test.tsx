// @vitest-environment node
// 纯源码静态断言，不需要 DOM；jsdom 环境会把 node:fs 外部化为浏览器模块。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
 *   - 16 个后台导航项、分组、权限与交互（折叠、抽屉、Esc、退出）全部保留；
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

  it('AdminSidebar 保留全部 16 个导航项、分组与文案', () => {
    const nav: Array<[href: string, label: string, hint: string, section: string]> = [
      ['/admin', '仪表盘', '概览', '主控台'],
      ['/admin/stats', '统计', '访问', '主控台'],
      ['/admin/monitor', '监控', '运行状态', '主控台'],
      ['/admin/posts', '文章', '撰写', '内容'],
      ['/admin/comments', '评论', '审核', '内容'],
      ['/admin/tags', '标签', '分类', '内容'],
      ['/admin/media', '媒体', '图片', '内容'],
      ['/admin/friend-links', '友链', '外链', '内容'],
      ['/admin/users', '用户', '权限', '系统'],
      ['/admin/announcements', '公告', '广播', '系统'],
      ['/admin/settings', '设置', '站点', '系统'],
      ['/admin/security', '安全', '审计', '系统'],
      ['/admin/mail', '邮件中心', '邮件', '系统'],
      ['/admin/cache', '缓存管理', 'ESA', '系统'],
      ['/admin/audit', '审计日志', '操作记录', '系统'],
      ['/admin/ai', 'AI 助手', 'AI', '系统'],
    ];

    expect(nav).toHaveLength(16);

    for (const [href, label, hint, section] of nav) {
      expect(files['AdminSidebar.tsx'], `导航 href 丢失：${href}`).toContain(`href: '${href}'`);
      expect(files['AdminSidebar.tsx'], `导航 label 丢失：${label}`).toContain(`label: '${label}'`);
      expect(files['AdminSidebar.tsx'], `导航 hint 丢失：${hint}`).toContain(`hint: '${hint}'`);
      expect(files['AdminSidebar.tsx'], `导航分组丢失：${section}`).toContain(`section: '${section}'`);
    }

    // 权限门槛分布：author 5 项、admin 2 项、super_admin 9 项（改动不得放宽/收紧）。
    const count = (re: RegExp) => (files['AdminSidebar.tsx'].match(re) ?? []).length;
    expect(count(/requiredRole: 'author'/g)).toBe(5);
    expect(count(/requiredRole: 'admin'/g)).toBe(2);
    expect(count(/requiredRole: 'super_admin'/g)).toBe(9);

    // 角色标签与权限过滤保留。
    for (const roleLabel of ['普通用户', '作者', '管理员', '超级管理员']) {
      expect(files['AdminSidebar.tsx']).toContain(roleLabel);
    }
    expect(files['AdminSidebar.tsx']).toContain('hasPermission(item.requiredRole)');
    expect(files['AdminSidebar.tsx']).toContain('aria-current={active ?');
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
