# 地图模式切换粒子动效设计

## 概述

在访客地理分布地图（DualModeGeoMap）的国际/中国模式切换时，用 Canvas 2D 粒子系统实现"破碎→飞散→聚合"过渡动效，替代当前的简单 CSS opacity 淡入淡出。

## 技术方案

**Canvas 2D 粒子系统**，零新依赖。

### 动画流程

```
用户点击切换按钮
  ↓
Phase 1 — 破碎（~400ms）
  从 ECharts Canvas 采样像素 → 生成 ~10000 粒子
  粒子获得随机初速度 + 轻微重力 → 向外飞散
  同时 ECharts 地图淡出
  ↓
Phase 2 — 过渡（~200ms）
  粒子在空中自由飘散（惯性+阻尼）
  底层切换 ECharts 到新地图模式
  ↓
Phase 3 — 聚合（~600ms）
  新地图的粒子目标位置计算完成
  粒子从当前位置飞向目标位置（缓动 easeOutCubic）
  粒子逐渐不透明，ECharts 地图淡入
  ↓
完成 — 移除粒子层，显示新地图
```

### 粒子采样

- 从 ECharts 的 Canvas 元素 `getImageData` 读取像素
- 按步长采样（每隔 N 个像素取一个），只取非透明像素
- 颜色直接从像素 RGBA 提取，保持视觉一致

### 粒子数据结构

```
每个粒子: x, y, vx, vy, targetX, targetY, r, g, b, alpha, size
```

### 动画循环

- `requestAnimationFrame` 驱动
- 每帧更新所有粒子位置并绘制到覆盖层 Canvas
- 覆盖层：绝对定位的 `<canvas>` 覆盖在 ECharts 容器上方，`pointer-events: none`

### 性能优化

- 粒子数量根据设备 `devicePixelRatio` 和 `hardwareConcurrency` 动态调整（低端 5000，高端 12000）
- 粒子绘制用 `fillRect` 而非 `arc`（性能高 3 倍）
- 使用 TypedArray 存储粒子数据，减少 GC 压力

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `astro/src/lib/map-particles.ts` | 新增 | 粒子系统核心（采样、动画、渲染） |
| `astro/src/components/stats/DualModeGeoMap.tsx` | 修改 | `handleModeSwitch` 中调用粒子动效 |

## 约束

- 零新 npm 依赖
- 动画总时长 ~1.2s
- 现代设备 60fps，低端设备降级到 30fps
- 不影响 ECharts 地图的正常交互（缩放、平移、悬停）
