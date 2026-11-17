# 科幻简约首页 Demo 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在独立 `/sci-fi-demo` 路由交付可验证的博客首页视觉 Demo。

**架构：** Astro 独立页面提供内容与真实链接，局部 CSS 提供响应式视觉和克制动效；仅在移动菜单需要时使用原生增强，不改变应用全局。

**技术栈：** Astro、TailwindCSS 项目环境、局部 CSS、现有 Geist/Noto 字体、Playwright、Vitest。

## 全局约束

- 不修改现有首页、全局样式、业务组件、配置或其他未提交文件。
- React 组件如有新增必须 `export default`；不新增依赖。
- 遵循 `docs/superpowers/specs/2026-11-16-sci-fi-minimal-demo-design.md` 的视觉与可访问性要求。
- 用户已指定使用子智能体执行；不提交 Git，不部署。

### 任务 1：独立 Demo 与行为验证

**新增文件：**
- `astro/src/pages/sci-fi-demo.astro`：语义化页面、导航、Hero、内容与页脚。
- `astro/src/styles/sci-fi-demo.css`：Demo 局部设计令牌、布局、响应式与减少动态。
- `astro/src/components/demo/SciFiDemo.tsx`：仅在原生页面无法满足移动菜单时新增。
- `astro/e2e/sci-fi-demo.spec.ts`：页面与交互验证。

- [ ] 先写 Playwright 测试，断言 `getByRole('heading', { name: '胡巴的博客', exact: true })` 可见、`浏览文章` 链接指向 `/posts`、移动菜单可开关并支持 Escape、390px 时 `document.documentElement.scrollWidth <= window.innerWidth`。
- [ ] 在临时 `127.0.0.1:4333` 服务上运行测试，确认因 `/sci-fi-demo` 尚未实现而失败。
- [ ] 按已确认的设计文档实现局部 Astro 页面与样式，复用 `SITE_CONFIG` 的名称、ICP 和公安备案链接，所有导航指向已存在路由。
- [ ] 重跑 Demo Playwright 测试，记录通过数量与退出码。
- [ ] 在 `astro` 目录运行 `npx vitest run` 和 `npm run build`，记录完整结果。
- [ ] 由独立审查子智能体检查实现范围、响应式和可访问性；主智能体验证桌面与移动端截图。

### 任务 2：交付预览

**范围：** 不新增产品功能。

- [ ] 检查 `git diff` 和新增文件，确认没有覆盖现有未提交工作。
- [ ] 收集子智能体结果，核实所有验证命令的真实退出码。
- [ ] 提供 `/sci-fi-demo` 的本地预览路径、桌面/移动截图与测试结果；明确 Demo 尚未替换正式首页。
