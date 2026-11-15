/**
 * PocketBase 基地址解析（SSR / 浏览器两端）
 *
 * 背景（2026-11 生产事故）：
 * - 部署产物里 PUBLIC_POCKETBASE_URL 被烘焙成公网域名 https://hlydwz.com；
 * - 服务端渲染仍用这个公网域名取数，请求绕回 ESA/SafeLine，被 WAF 返回 403 挑战页，
 *   JSON 解析失败 → 首页无文章、/posts/<slug> 渲染「文章不存在」。
 *
 * 约定：
 * - 浏览器侧必须用公网域名（客户端跨域/缓存策略依赖它）；
 * - 服务端渲染走本地回环直连（默认 http://127.0.0.1:8090 或 Caddy 的 127.0.0.1:18080），
 *   由部署机通过运行时环境变量 PB_SERVER_URL 指定，不参与构建期内联。
 */

// 本地开发兜底：与改造前各页面 `|| 'http://localhost:8090'` 的行为保持一致。
const DEFAULT_LOCAL_PB_URL = 'http://localhost:8090';

/** 去掉尾部斜杠，避免拼接出 `https://host//api/...` 这类路径。 */
function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * 返回当前运行环境下应使用的 PocketBase 基地址（无尾部斜杠）。
 *
 * - 浏览器：PUBLIC_POCKETBASE_URL（构建期由 Vite 内联成字面量，保证前端仍走公网域名）。
 * - 服务端：优先读取运行时环境变量 PB_SERVER_URL（回环直连，绕开边缘 WAF）；
 *   未配置时回退到公开地址，避免部署遗漏导致 SSR 完全取不到数。
 */
export function pbBaseUrl(): string {
  // 构建期常量替换：PUBLIC_ 前缀变量会被 Vite 内联进产物，字符串里不能出现间接访问。
  const publicUrl = trimTrailingSlashes(import.meta.env.PUBLIC_POCKETBASE_URL || DEFAULT_LOCAL_PB_URL);

  // 浏览器端只有公开地址可用，直接返回。
  if (typeof window !== 'undefined') {
    return publicUrl;
  }

  // 服务端：process.env 不会被内联，保证部署机在运行时可通过环境变量覆盖。
  const serverUrl = trimTrailingSlashes((typeof process !== 'undefined' && process.env?.PB_SERVER_URL) || '');
  return serverUrl || publicUrl;
}
