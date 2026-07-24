# 项目展示页设计（子项目 F）

日期：2026-07-18
状态：已批准（用户"可以"确认）

## 范围

- 前端（本次实施）：`/projects` 项目展示页、`astro/src/config/projects.ts` 数据配置、导航入口
- 后端：**无**（用户确认配置文件硬编码，零后端依赖）

已确认决策：

- 项目信息**硬编码**在 `src/config/projects.ts`，改项目 = 编辑文件提交
- 页面纯静态（无数据获取岛屿），动效用 ScrollReveal 等非数据组件

## 前端设计

### `astro/src/config/projects.ts`

```ts
export interface ProjectLink {
  demo?: string;
  github?: string;
  article?: string;
}

export interface Project {
  name: string;
  tagline: string;
  description: string;
  tech: string[];
  status: 'active' | 'wip' | 'archived';
  links: ProjectLink;
  featured?: boolean;
}

export const projects: Project[] = [...]
```

预填条目：① 胡巴的博客（featured，Astro 6/React 19/PocketBase/Tailwind/Docker，active，demo 链接）；②③ 两条标注「示例项目，请编辑 src/config/projects.ts」的占位。

### `/projects` 页面（`astro/src/pages/projects.astro`）

延续设计系统：ParticleField 背景（`hidden lg:block`）+ `relative z-10` 内容 + ScrollReveal 头部（kicker "Projects" + h1 项目 + 说明文案）。

- **Featured 区**：每个 featured 项目一张大卡片：名称 + 状态徽章（active=运营中 teal / wip=开发中 amber / archived=已归档 zinc）+ tagline + description + tech mono chips + 链接按钮组（在线访问/GitHub/相关文章，仅渲染存在的链接）
- **网格区**：非 featured 项目两列卡片（sm:grid-cols-2），同款信息结构，hover 上浮 + GlowCard 光晕（复用 `ui/GlowCard`）
- ScrollReveal 分节入场；无项目时显示空态文案

### 导航入口

- `Header.tsx` `MORE_LINKS` 追加 `{ href: '/projects', label: '项目', ... }`
- `SideNav.tsx` `moreNavItems` 追加 `/projects`

## 明确不做

- 不做后端集合与接口（硬编码决策）
- 不做项目详情子页面（单页展示）
- 不做截图/封面图（cards 纯文字信息，保持轻量）

## 验证

- `npm run build` + check:visual 加 `/projects`
- 页面截图确认卡片渲染与徽章颜色
