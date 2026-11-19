/**
 * 「轨道日志」跨框架视觉原语 class 常量。
 *
 * 纯数据模块：不导入 React / Astro / 运行时请求，静态 Astro 原语（PageShell、
 * SectionHeading）与后续 React 岛屿都只消费这里的字符串，保证两套渲染路径
 * 共享同一份 class 契约。设计令牌与规则真值在 global.css。
 */
export const orbitalClasses = Object.freeze({
  shell: 'orbital-shell',
  panel: 'orbital-panel',
  eyebrow: 'orbital-eyebrow',
  action: 'orbital-action',
} as const);
