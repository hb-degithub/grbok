import { useEffect, useRef } from 'react';

/**
 * 数学公式渲染组件 -- 懒加载 KaTeX，支持行内与块级公式。
 *
 * 用法：
 * <MathBlock tex="E = mc^2" display={true} />
 *
 * 依赖：npm i katex（仅在需要时安装）
 * 此组件不修改任何现有渲染逻辑（遵守资产保全协议）。
 *
 * 安全：CSS 通过 npm 包 import 打包（非 CDN），避免供应链投毒。
 */

interface MathBlockProps {
  /** LaTeX 公式文本 */
  tex: string;
  /** 是否块级显示（默认行内） */
  display?: boolean;
  className?: string;
}

export default function MathBlock({ tex, display = false, className }: MathBlockProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const katex = (await import('katex')).default;
        // CSS 通过 npm 包 import，由 Vite 打包到构建产物中（非 CDN）
        await import('katex/dist/katex.min.css');
        if (!cancelled && ref.current) {
          katex.render(tex, ref.current, {
            displayMode: display,
            throwOnError: false,
          });
        }
      } catch (err) {
        if (!cancelled && ref.current) {
          ref.current.textContent = `公式渲染失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tex, display]);

  return <span ref={ref} className={className} />;
}
