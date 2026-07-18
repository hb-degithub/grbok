# 照片相册设计（子项目 E）+ 后端接口契约

日期：2026-07-17
状态：已批准（用户"继续"确认）

## 范围

- 前端（本次实施）：`/gallery` 相册页（分组筛选 + 瀑布流 + 灯箱）、导航入口
- 后端（用户实现，本文件即契约）：`gallery_items` 集合

已确认决策：

- 内容形态：**照片相册**（瀑布流网格 + 点击灯箱放大）
- **要分组筛选**（按专辑 album 字段）
- 工作模式：只做前端，后端以接口契约保留

## 前端设计

### `/gallery` 页面（`astro/src/pages/gallery.astro`）

延续设计系统：ParticleField 背景（`hidden lg:block`）+ `relative z-10` 内容 + ScrollReveal 头部（kicker "Gallery" + h1 相册 + 说明文案）。

**相册面板**（`components/gallery/GalleryBoard.tsx`，client:load，容器）

- 数据：`pb.collection('gallery_items').getList(1, 100, { sort: 'sort_order,-created', filter: 'status = "show"' })`；集合未创建/网络错误 → 错误态；空集合 → 空态
- 专辑列表：从数据中提取去重 album（非空），"全部" + 各专辑
- 客户端筛选（切换无请求）；图片 URL：`${PB}/api/files/gallery_items/${item.id}/${item.photo}`，缩略图加 `?thumb=300x300`

**分组筛选条**（Board 内）

- chips 行："全部" + 专辑名；选中态 teal 实心，framer-motion `layoutId` 滑动指示 pill；计数角标（该专辑图片数）

**瀑布流网格**（Board 内，复用 `reactbits/Masonry`）

- `columns={{ mobile: 1, tablet: 2, desktop: 3 }}` `gap={16}`
- 图片卡片：`<img loading="lazy">` 缩略图，hover 微放大（`whileHover scale 1.02`）+ 标题（有 title 时底部渐变条显示）
- 点击打开灯箱并记录当前索引

**灯箱**（`components/gallery/GalleryLightbox.tsx`，受控组件）

- props：`items`（当前筛选后的数组）、`index`（当前索引，null 关闭）、`onClose()`、`onNavigate(newIndex)`
- AnimatePresence：背板 blur + 大图 scale/opacity 入场；图下显示 title/description + "3 / 24" 计数
- 交互：ESC/点背板关闭；左右箭头按钮 + 键盘 ←/→ 切换；打开时锁 body 滚动（沿用 SideNav 的 scrollbar 补偿模式）
- 预加载相邻图片（`new Image()`）

### 导航入口

- `Header.tsx` `MORE_LINKS` 追加 `{ href: '/gallery', label: '相册', ... }`
- `SideNav.tsx` `moreNavItems` 追加 `/gallery`

## 后端接口契约（用户实现）

### `gallery_items` 集合（迁移）

| 字段 | 类型 | 约束 |
|---|---|---|
| `photo` | file | required；mime 限 image/*；maxSelect 1；`protected: false` |
| `title` | text | 可选，≤100 |
| `description` | text | 可选，≤500 |
| `album` | text | 可选，≤50（分组；空字符串视为未分组） |
| `sort_order` | number | 可选，整数 |
| `status` | select | 单选 show/hidden，默认 show |
| `created` | autodate | 自动 |

规则：`listRule = viewRule = 'status = "show"'`（公开读）；`createRule = updateRule = 'author 及以上'`；`deleteRule = super_admin`。

图片 URL（PB 标准，file 非 protected 时公开可达）：

```
{PB_URL}/api/files/gallery_items/{recordId}/{photoFilename}
{PB_URL}/api/files/gallery_items/{recordId}/{photoFilename}?thumb=300x300
```

## 明确不做

- 不做上传 UI（PB 后台直接传；后续子项目可考虑 admin 管理页）
- 不做 lazy 无限滚动（一次拉 ≤100，量级内可接受）
- 不做视频
- 后端实现不属于本次工作

## 验证

- `npm run build` + check:visual 加 `/gallery`
- 集合不存在时全页错误/空态不崩（Playwright，pageErrors 为空）
- 灯箱交互探针（如果网格为空则验证空态即可）
