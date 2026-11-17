# 技术栈卡片点击内联展开修复设计

## 背景与根因
线上桌面端悬停 TechCard 时，CSS 已使浮层 `opacity: 1`，但绝对定位浮层完全位于外层 `GlareHover` 的 `overflow: hidden` 容器之外，被裁切。桌面点击又被 `(hover: none)` 条件排除，因此用户无法查看详情。

## 目标与范围
- TechCard 在桌面与触屏均通过点击在卡片下方内联展开/收起详情。
- 使用原生 button 提供 Enter/Space 键盘操作及展开状态的无障碍关联。
- 移除 TechCard 内被裁切的桌面悬浮详情，不改共享 GlareHover，避免影响扫光边界。
- 不改 FeatureCard 或其他页面。

## 实现
`TechCard.tsx` 的紧凑行改为 `type="button"`，始终切换 `open`；箭头状态随 `open` 旋转。`aria-expanded` 表示状态，`aria-controls` 关联固定详情容器。内联详情始终挂载，通过 grid-template-rows 过渡展开/收起，不使用 Tailwind 未分层的 overflow 类覆盖。

`about.astro` 技术栈的操作提示统一为“点击卡片展开技术详情”，保留 GlareHover 视觉包裹。内联详情留在 GlareHover 容器内，避免向上越界；展开时卡片高度自然增加。

## 公告与 Dock 重叠修复
桌面 Dock 固定在 `top: 0`、`z-50`，而公告在普通文档流顶部，没有预留导航空间，导致公告被遮挡。公告根节点提供稳定 class，BaseLayout 外层用 `:has(.announcement-bar)` 条件匹配，仅在公告实际存在时为桌面预留 Dock 高度（80px），移动端避开汉堡按钮（56px）；无公告或最后一条公告关闭后间距归零，不产生额外空白。公告保持移动端可见。新增 Playwright 几何断言确保公告与 Dock/汉堡不重叠，并验证关闭和无公告状态的布局回收。

## 测试与验收
- TechCard Vitest：桌面媒体查询下点击展开/收起、键盘操作、aria 状态与详情关联；先运行确认失败，再改生产代码。
- Playwright：桌面点击后详情真实可见且不被裁切，再次点击收起；公告与 Dock 不重叠且可关闭。
- `npx vitest run` 全部通过；`npm run build` 成功。
- 不在本次修复中提交或回滚既有 `.env.example`、`astro/vitest.config.ts`、`scripts/monitor-safeline.sh` 改动。

## 回滚
回滚 TechCard、about.astro 及新增测试文件即可恢复原行为；无数据库、部署配置或运行时数据变更。
