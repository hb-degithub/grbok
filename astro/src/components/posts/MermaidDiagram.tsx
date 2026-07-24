import { useEffect, useRef, useId } from 'react';

/**
 * Mermaid 图表渲染组件 -- 懒加载 mermaid 库，仅当文章含 ```mermaid 块时才加载。
 *
 * 用法（在文章渲染后扫描 mermaid 代码块并替换）：
 * <MermaidDiagram code="graph TD; A-->B" />
 *
 * 依赖：npm i mermaid（仅在需要时安装）
 * 此组件不修改任何现有渲染逻辑（遵守资产保全协议）。
 *
 * 安全：securityLevel 设为 'strict'，禁止图中嵌入 HTML/script，防止 XSS。
 */

interface MermaidDiagramProps {
  code: string;
  /** 主题，默认跟随暗色 */
  theme?: 'default' | 'dark' | 'forest';
}

export default function MermaidDiagram({ code, theme = 'dark' }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  // useId 保证 SSR/CSR 一致，避免 hydration mismatch
  const rawId = useId();
  const renderId = `mermaid-${rawId.replace(/[^a-zA-Z0-9-]/g, '')}`;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        // strict 模式禁止在图中嵌入 HTML，防止 XSS
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
        const { svg } = await mermaid.render(renderId, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled && ref.current) {
          ref.current.textContent = `Mermaid 渲染失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    })();

    return () => {
      cancelled = true;
      // 清理 mermaid.render 可能遗留的临时 DOM 节点
      const temp = document.getElementById(renderId);
      if (temp) temp.remove();
    };
  }, [code, theme, renderId]);

  return <div ref={ref} className="mermaid-container my-6 overflow-x-auto" role="img" />;
}
