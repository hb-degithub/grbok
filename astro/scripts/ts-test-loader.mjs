/**
 * 测试用 TypeScript 加载器 —— 让 `node --test` 可以直接加载 .ts / .mts / .tsx 测试与源码。
 *
 * 背景：`test:admin-auth` 以 TypeScript 文件作为测试入口。Node 内置的类型剥离建立在
 * amaro 转译器之上，部分发行版构建（Ubuntu/Debian 的 nodejs +dfsg 以 --without-amaro 编译）
 * 加载 .ts 时直接抛 ERR_NO_TYPESCRIPT。本加载器复用仓库已有的 esbuild devDependency
 * 在加载期做类型剥离，让同一 npm 脚本在 Node 22.12 及以上都可运行，且不新增依赖。
 *
 * 用法：node --import ./scripts/ts-test-loader.mjs --test test/xxx.test.ts
 *      （`npm run test:admin-auth` 已带上该 --import，无需手动添加）
 *
 * 运行时兼容（不抬高 package.json engines 下限）：
 * - Node >= 22.15：`node:module.registerHooks` 可用，用 esbuild 注册 load hook；
 *   覆盖 Ubuntu/Debian no-amaro 构建（22.15+ 上该 API 仍然存在）。
 * - Node 22.12–22.14（官方构建自带 amaro）：`registerHooks` 尚不存在，本加载器不注册 hook，
 *   改为依赖原生 --experimental-strip-types；原生类型剥离未开启时显式报错并给出运行命令。
 * - Node < 22.15 且构建未编译 amaro（Ubuntu/Debian +dfsg）：两条路都不可用，显式报错说明
 *   安装要求并以失败退出，绝不静默跳过或假装测试通过。
 * - 不 monkey patch 任何全局模块函数；esbuild 仅在 registerHooks 分支内按需动态 import。
 *
 * 行为约定：
 * - 只接管 `file:` 协议下扩展名为 .ts / .mts / .tsx 的模块，其余请求原样交给 nextLoad；
 * - 不改写模块路径，不做打包：模块解析、`import.meta.url` 与相对路径读取都保持调用方原样
 *   （部分测试用 `new URL('../src/...', import.meta.url)` 读取源码，依赖这一行为）；
 * - 转译产物为 ESM，target 对齐 Node 22，内联 sourcemap 让断言失败时定位到原始行；
 * - jsx 预设 automatic，使未来测试直接 import .tsx 组件时无需再改动本加载器。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 必须用顶层 await 动态 import：静态 `import { registerHooks } from 'node:module'` 在
// Node < 22.15 上拿不到该导出（链接期报错或绑定为 undefined），无法据此进入回退分支。
const nodeModule = await import('node:module');
const registerHooks = nodeModule.registerHooks;

const NATIVE_TS_FLAG = '--experimental-strip-types';

const EXT_LOADER = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.tsx': 'tsx',
};

if (typeof registerHooks !== 'function') {
  // Node < 22.15：没有 registerHooks，无法把 esbuild 挂进模块加载链。
  const nativeTypeScript = process.features?.typescript ?? false;
  const amaroCompiled = process.config?.variables?.node_use_amaro;

  if (!nativeTypeScript) {
    const runtime =
      `Node ${process.version}（node_use_amaro=${String(amaroCompiled)}，` +
      `process.features.typescript=${String(nativeTypeScript)}）`;

    const requirements =
      amaroCompiled === false
        ? [
            '该 Node 构建没有编译 amaro（如 Ubuntu/Debian 的 nodejs +dfsg），原生',
            `${NATIVE_TS_FLAG} 会抛 ERR_NO_TYPESCRIPT；且 Node < 22.15 没有 registerHooks，无法注册 esbuild 加载钩子。`,
            '安装要求（任选其一）：',
            '  1) 升级到 Node >= 22.15（官方构建或 Ubuntu/Debian 构建均可，本加载器会用 esbuild 注册钩子）；',
            `  2) 改用自带 amaro 的官方 Node 22.12–22.14，并以 NODE_OPTIONS=${NATIVE_TS_FLAG} npm run test:admin-auth 运行。`,
          ]
        : [
            '该 Node 版本 < 22.15，没有 registerHooks；官方构建虽自带 amaro，但原生类型剥离尚未开启。',
            '运行方式（任选其一）：',
            `  1) NODE_OPTIONS=${NATIVE_TS_FLAG} npm run test:admin-auth（官方 Node 22.12–22.14）；`,
            '  2) 升级到 Node >= 22.15（本加载器会用 esbuild 注册钩子）。',
          ];

    throw new Error(
      [
        '[ts-test-loader] 无法加载 TypeScript 测试。',
        runtime,
        ...requirements,
        '本次运行已失败退出，不会静默跳过或假装测试通过。',
      ].join('\n'),
    );
  }

  console.warn(
    '[ts-test-loader] 当前 Node 不提供 node:module.registerHooks（< 22.15），' +
      `已回退到原生 ${NATIVE_TS_FLAG} 类型剥离，不再用 esbuild 注册加载钩子。`,
  );
} else {
  const { transformSync } = await import('esbuild');

  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith('file:')) return nextLoad(url, context);

      const { pathname } = new URL(url);
      const match = /\.[cm]?tsx?$/.exec(pathname);
      if (!match) return nextLoad(url, context);

      const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), {
        loader: EXT_LOADER[match[0]] ?? 'ts',
        format: 'esm',
        target: 'node22',
        jsx: 'automatic',
        sourcefile: pathname,
        sourcemap: 'inline',
      });

      return { format: 'module', source: code, shortCircuit: true };
    },
  });
}
