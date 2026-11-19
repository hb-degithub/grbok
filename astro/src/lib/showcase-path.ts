/**
 * 展示页（首页）路径判断 —— 服务端布局与客户端岛共用同一份。
 *
 * 背景：BaseLayout 只在展示页挂载 Splash / Welcome / Cursor 这几个「轨道日志」氛围岛，
 * WelcomeOverlay 自身还会再做一次 pathname 守卫（防止它被别处挂到内页）。
 * 两处各写一套判断就会出现不一致：布局曾接受 `/index/` 并挂了岛，组件却只认 `/`，
 * 于是 `/index/` 上「岛加载了但引导永不出现」。
 *
 * 现在判断收敛到这一个函数，并且**只认规范首页 `/`**：
 * - `pages/index.astro` 的路由就是 `/`，其它写法都不是同一页；
 * - `/index/` 实测走的是 404 页（同一份 BaseLayout），把它当展示页等于在 404 上挂氛围特效，
 *   所以宁可「不扩大范围」，也不做前缀/后缀/Trailing-slash 归一化匹配。
 */

/** 展示页只有规范首页一个 pathname。 */
const SHOWCASE_PATHNAME = '/';

/** 给定 pathname 是否属于展示页（首页）。 */
export function isShowcasePathname(pathname: string): boolean {
  return pathname === SHOWCASE_PATHNAME;
}
