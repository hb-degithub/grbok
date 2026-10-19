# 数据地球验收记录

2026-09-18，本地分支 `codex/stats-data-globe`。当前源站已包含本次版本；ESA 旧页面缓存按用户要求暂不刷新。

## 生产验收（11:03）

用户授权上线后，核对到生产服务已于 10:53:23 更新；生产静态目录、SSR 客户端目录及本地构建中的 `Globe3D.B5HvaP5a.js`、`Globe3D.DP6uPcuu.css`、`StatsDashboard.DSmVWYsK.js` 的 SHA-256 均一致。因此未再次覆盖发布目录或重启服务，避免覆盖并行任务已经上线的内容。

- SSR 服务为 active，源站 SSR 与 Caddy 的 `/stats` 均返回 200。
- 重新运行 Vitest：4 个文件、33 项测试通过。
- 实际公网浏览器访问 `https://hlydwz.com/stats?release=20260918-globe`，不拦截统计 API，8 项检查通过，无页面异常或失败请求：国家数据、暂停/复位、拖拽、主题切换、2D/3D 往返、省份资源移除、320px 布局和首页/关于/状态页可用性。
- 线上截图：`tmp/stats-globe-review/production-light.png`、`production-dark.png`、`production-mobile.png`；完整记录：`production-versioned-verification.json`。
- 普通 `/stats` 和 `/stats/` 在部分 ESA 缓存仍返回旧脚本。项目 ESA 配置集合没有凭据记录，定向刷新调用未提交；用户明确选择“暂时不刷新”。上述版本参数链接已验证加载新版。未改动 ESA 缓存规则、认证、数据库或其他部署配置。

以下为实现阶段的历史本地验收记录。

## 最新调整：移除中国省份视图

按用户后续要求，删除世界/中国区域切换、省份渲染、相关提示、聚合和地图请求，仅保留世界地图及 2D/3D 切换。中国国家级访问数据、拖拽、自转和复位继续保留。此调整取代下文初版的中国聚焦和省份展示设计。

最新验收：`npm run build` 成功，全部 33 项 Vitest 测试通过，地球和地图组件严格 TypeScript 检查通过。`tmp/stats-globe-review/verify-world-only.mjs` 的 3 项浏览器检查通过，无页面异常；实际地图请求均为 `world-zh.json`，无省份资源请求。验证了中国国家数据提示、2D/3D 往返和 320px 布局。最新截图为 `world-only-light.png`、`world-only-dark.png` 和 `world-only-mobile.png`。

## 完成内容

- 明暗主题球面光照、遮挡背面轮廓、固定粒子采样、访问量热点、完整球面自适应。
- 亚洲初始视角、中国聚焦、暂停与复位、鼠标与触摸、键盘操作、悬停数据。
- 不可见时暂停渲染、减少动态效果偏好、资源清理和 WebGL 不可用时回退。
- 地理分布区域、图例和中文国家榜单布局。
- 浏览器回归发现 2D 切回 3D 时 ECharts 收到已失去布局的容器尺寸，导致零尺寸变换求逆异常。增加连接状态和尺寸检查，并验证新增回归测试先失败后通过。

用户确认 ESA 不提供中国省份请求头，省份统计暂不处理。现有中国视角注明数据尚未细分到省份，未调整 ESA、采集或后端。

## 验证证据

- `npm run build`：通过。
- `npx vitest run`：4 个测试文件，33 项通过。
- 本次地球与地图组件的严格 TypeScript 检查：通过。
- `git diff --check`（本次修改路径）：通过。
- `tmp/stats-globe-review/verify.mjs`：12 项浏览器检查通过，`failures: []`。包含 1440px、390px、320px，两个主题，模式切换、真实国家数据悬停、拖拽/键盘/复位、暂停稳定性、减少动态效果和强制禁用 WebGL。省份测试只使用本地测试夹具，未伪造线上数据。
- 实际公开统计接口快照作为浏览器测试输入。截图 `final-world-light.png`、`final-world-dark.png`、`final-mobile-320-light.png` 等保存在 `tmp/stats-globe-review/`。

## 环境限制

- 全站 `npm run check` 无法启动诊断：当前 TypeScript 7.0.2 不提供 Astro 检查工具依赖的编程 API。未为此变更项目依赖。
- 本地页面访问生产设置及公告接口时出现网络/CORS 失败；统计接口由已读取的公开数据快照提供，地图资源来自本地构建产物。浏览器地球交互检查无未捕获异常。这不是完整生产部署验收。
- 构建仍报告现有 face-api 浏览器 fs 外置及大包警告。
- 本地 SSR 预览进程还输出了 React `Invalid hook call` 日志，页面与上述客户端检查能完成。其来源未定位，本次未将全站 SSR 判定为无异常；相关记录与 Astro 类型检查限制独立于浏览器地球验收结果。

工作区中其他任务的部署、认证、监控及页脚修改均未纳入本次变更。
