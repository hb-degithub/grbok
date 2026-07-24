// 共享动效预设：全站统一的缓动、时长与 framer-motion variants。
// 新增动画组件优先复用本文件，避免每处各写一套参数。
import type { Variants, Transition } from 'framer-motion';

/** 全站主缓动（与 global.css 的 --ease-out-expo 一致） */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** 入场：上浮 + 淡入 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_EXPO },
  },
};

/** 错峰容器：配合 fadeUp 等子项 variants 使用 */
export const staggerContainer = (
  staggerChildren = 0.08,
  delayChildren = 0,
): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren, delayChildren } },
});

/** 弹性按压/回弹过渡 */
export const springPop: Transition = { type: 'spring', stiffness: 400, damping: 17 };

/** 悬停上浮 / 按压缩放（配合 whileHover / whileTap） */
export const hoverLift = { y: -4 } as const;
export const tapPress = { scale: 0.98 } as const;
