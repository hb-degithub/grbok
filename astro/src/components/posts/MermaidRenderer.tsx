import { useEffect, useRef } from 'react';

/**
 * 文章正文 Mermaid 图表渲染岛屿。
 *
 * 设计约束：
 * 1. 只在文章正文包含 ```mermaid 时由 `[slug].astro` 挂载（`client:idle`），
 *    没有图表的文章不会下载 mermaid（真正的几百 KB 由下面的动态 import 承担）。
 * 2. 组件本身不渲染任何 DOM（`return null`），避免在正文里插入额外的空盒子。
 * 3. mermaid 只在浏览器里动态加载：SSR 阶段只输出 `<div class="mermaid">源码</div>`，
 *    这样即使客户端脚本失败，读者仍能看到图表源码。
 * 4. 失败时保留源码 + 展示可读错误，绝不抛 pageerror（`suppressErrors` + try/catch）。
 * 5. 幂等：mermaid 会给渲染过的节点打 `data-processed`；这里也按主题记录状态，
 *    主题切换（`<html class="dark">`）时先把源码还原再按新主题重渲染一次。
 */

type MermaidTheme = 'dark' | 'default';

/** 渲染失败提示，显示在源码下方（源码本身保持可见）。 */
const ERROR_MESSAGE = '图表渲染失败，上面是原始定义。';

/** 主题切换后的防抖时间：避免连续 class 变化触发多次重渲染。 */
const THEME_DEBOUNCE_MS = 150;

function currentTheme(): MermaidTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

export default function MermaidRenderer() {
  const renderedThemeRef = useRef<MermaidTheme | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 串行化渲染：主题切换和首次渲染不会并发跑 mermaid。 */
    let queue: Promise<void> = Promise.resolve();
    /** 原始源码：mermaid 会原地替换 innerHTML，重渲染前必须还原。 */
    const sources = new Map<HTMLElement, string>();

    const collectNodes = () => Array.from(document.querySelectorAll<HTMLElement>('.mermaid'));

    const resetNode = (node: HTMLElement) => {
      const source = sources.get(node);
      if (source !== undefined && node.querySelector('svg')) {
        // 只还原「已经渲染过」的节点：失败节点此时只剩文本，不需要覆盖
        node.textContent = source;
      }
      node.removeAttribute('data-processed');
      node.classList.remove('mermaid-rendered', 'mermaid-error');
      node.querySelector('.mermaid-error')?.remove();
    };

    const markError = (node: HTMLElement, detail: string) => {
      node.classList.add('mermaid-error');
      const message = document.createElement('p');
      message.className = 'mermaid-error';
      message.textContent = detail ? `${ERROR_MESSAGE}（${detail}）` : ERROR_MESSAGE;
      node.appendChild(message);
    };

    const render = async () => {
      if (disposed) return;
      const nodes = collectNodes();
      if (!nodes.length) return;

      const theme = currentTheme();
      const allProcessed = nodes.every((node) => node.getAttribute('data-processed') === 'true');
      // 已经按当前主题渲染过（或失败过）就跳过：重复调用是幂等的
      if (allProcessed && renderedThemeRef.current === theme) return;

      nodes.forEach((node) => {
        if (!sources.has(node)) sources.set(node, node.textContent ?? '');
        resetNode(node);
      });

      let mermaid: typeof import('mermaid').default;
      try {
        const module = await import('mermaid');
        mermaid = module.default;
      } catch {
        // mermaid 主包加载失败（网络/缓存问题）：保留源码，不重试、不抛错
        return;
      }
      if (disposed) return;

      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'strict',
        // 失败时不要用 mermaid 自带的错误图替换源码，由本组件展示可读提示
        suppressErrorRendering: true,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      });

      try {
        // 节点级错误吞掉，避免一个坏图表把整页脚本打挂（pageerror 的来源）
        await mermaid.run({ nodes, suppressErrors: true });
      } catch {
        // run 已经 suppressErrors，这里只是双保险
      }
      if (disposed) return;

      renderedThemeRef.current = theme;

      for (const node of nodes) {
        if (node.querySelector('svg')) {
          node.classList.add('mermaid-rendered');
          continue;
        }
        // 没有 svg 说明该节点渲染失败；mermaid 已把 data-processed 置为 true
        if (!node.querySelector('.mermaid-error')) {
          markError(node, '');
        }
      }
    };

    const enqueue = () => {
      queue = queue.then(render).catch(() => {
        // 渲染链内部已兜底，这里只保证队列不断
      });
      return queue;
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void enqueue();
      }, THEME_DEBOUNCE_MS);
    };

    // 首次：等浏览器空闲后再跑（client:idle 之外再让出一帧，避免抢首屏 LCP）
    void enqueue();

    // 主题跟随：BaseLayout 在 <html> 上切换 .dark，切换后按新主题重渲染
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'attributes' && record.attributeName === 'class')) {
        schedule();
      }
    });
    observer.observe(document.documentElement, { attributeFilter: ['class'] });

    return () => {
      disposed = true;
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return null;
}
