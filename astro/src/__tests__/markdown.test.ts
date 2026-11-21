// @vitest-environment node
/**
 * 文章正文 Markdown 渲染管线单测。
 *
 * 关注点（与需求一一对应）：
 *   1. 围栏代码块 + language class + hljs token 高亮；
 *   2. 未知语言退化为纯转义；
 *   3. GFM 表格、图片语法；
 *   4. 行内 / 块级 KaTeX 公式，失败保留原文；
 *   5. mermaid 围栏只输出源码容器；
 *   6. 原始 HTML 保留、script/onerror/javascript: 被清除；
 *   7. class 白名单过滤（hljs / language-* / katex / mermaid 保留，其余丢弃）；
 *   8. style 白名单过滤（KaTeX 排版属性保留，position:fixed / url() 丢弃）；
 *   9. 空字符串与超长输入不抛错；
 *  10. TOC 依赖的「无属性 h2/h3」约定；
 *  11. 共用 `sanitizeHtml`（评论等）没有被放宽。
 */
import { describe, it, expect } from 'vitest';
import { renderMarkdown, sanitizePostHtml } from '../lib/markdown';
import { sanitizeHtml } from '../lib/security';

describe('renderMarkdown - 代码块', () => {
  it('围栏代码块输出 hljs + language class，并高亮 token', () => {
    const html = renderMarkdown('```js\nconst answer = 42;\n```');

    expect(html).toContain('<pre><code class="hljs language-js">');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-number');
    expect(html).toContain('</code></pre>');
  });

  it('别名语言（py）同样保留 language class', () => {
    const html = renderMarkdown('```py\ndef f():\n    return "hi"\n```');

    expect(html).toContain('class="hljs language-py"');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  it('未知语言退化为纯转义，不加 language class', () => {
    const html = renderMarkdown('```totally-unknown\n<b>not markup</b> & x\n```');

    expect(html).toContain('<pre><code class="hljs">');
    expect(html).not.toContain('language-totally-unknown');
    expect(html).toContain('&lt;b&gt;not markup&lt;/b&gt; &amp; x');
    expect(html).not.toContain('<b>not markup</b>');
  });

  it('无语言围栏同样纯转义', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');

    expect(html).toContain('<pre><code class="hljs">');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('代码块里的内容不会被当成 Markdown / 公式', () => {
    // 用无语言围栏，走「纯转义」分支，才能证明内部语法没有被继续解析
    const html = renderMarkdown('```\n$not-math$ **not bold**\n```');

    expect(html).not.toContain('class="katex"');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('$not-math$ **not bold**');
  });
});

describe('renderMarkdown - 表格与图片', () => {
  it('GFM 表格渲染为 table/thead/tbody', () => {
    const html = renderMarkdown('| 名称 | 值 |\n| --- | --- |\n| a | 1 |');

    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>名称</th>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<td>a</td>');
  });

  it('图片语法保留 src/alt/title', () => {
    const html = renderMarkdown('![封面图](/uploads/cover.png "站点封面")');

    expect(html).toContain('<img');
    expect(html).toContain('src="/uploads/cover.png"');
    expect(html).toContain('alt="封面图"');
    expect(html).toContain('title="站点封面"');
  });

  it('图片 src 为 javascript: 时被清除', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
  });
});

describe('renderMarkdown - 数学公式', () => {
  it('行内公式渲染为 KaTeX，并保留排版 class', () => {
    const html = renderMarkdown('质能方程 $E = mc^2$ 很好用。');

    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-html');
    expect(html).toContain('class="mord');
    expect(html).toContain('<p>');
  });

  it('块级公式渲染为 katex-display，并保留分数排版（mfrac/vlist/size）', () => {
    const html = renderMarkdown('$$\n\\frac{a}{b} + \\sqrt{x}\n$$');

    expect(html).toContain('katex-display');
    expect(html).toContain('mfrac');
    expect(html).toContain('sqrt');
    expect(html).toContain('vlist-t');
    expect(html).toContain('style="');
  });

  it('行内 $$...$$ 按 display 渲染', () => {
    const html = renderMarkdown('段落 $$a^2 + b^2 = c^2$$ 结尾');

    expect(html).toContain('katex-display');
  });

  it('公式解析失败时保留原文，不输出 katex-error', () => {
    const html = renderMarkdown('坏公式 $\\frac{a$ 结束');

    expect(html).not.toContain('katex-error');
    expect(html).toContain('$\\frac{a$');
  });

  it('金额写法不会被误当公式', () => {
    const html = renderMarkdown('价格 $5 和 $10 不等。');

    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$5 和 $10');
  });

  it('行内代码里的 $ 不参与公式解析', () => {
    const html = renderMarkdown('`$x$` 是代码');

    expect(html).not.toContain('class="katex"');
    expect(html).toContain('<code>$x$</code>');
  });
});

describe('renderMarkdown - Mermaid', () => {
  it('mermaid 围栏输出源码容器，不在 SSR 渲染 SVG', () => {
    const html = renderMarkdown('```mermaid\ngraph TD;\n  A-->B;\n```');

    expect(html).toContain('<div class="mermaid">');
    expect(html).toContain('graph TD;');
    expect(html).toContain('A--&gt;B;');
    expect(html).not.toContain('<svg');
  });
});

describe('renderMarkdown - 原始 HTML 兼容与 XSS', () => {
  it('保留常见原始 HTML 标签', () => {
    const html = renderMarkdown('<mark>高亮</mark>\n\n<figure><figcaption>图注</figcaption></figure>');

    expect(html).toContain('<mark>高亮</mark>');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>图注</figcaption>');
  });

  it('清除 script / iframe / object / embed', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<object data="x"></object>\n\n<embed src="x">',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<embed');
  });

  it('清除 on* 事件属性', () => {
    const html = renderMarkdown('<img src="/a.png" onerror="alert(1)" onclick="alert(2)">');

    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).toContain('src="/a.png"');
  });

  it('清除 javascript: 链接与数据属性', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)" data-evil="1">点我</a>');

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data-evil');
    expect(html).toContain('点我');
  });
});

describe('class / style 白名单', () => {
  it('保留 hljs token 类，丢弃未知类', () => {
    const html = sanitizePostHtml('<span class="hljs-keyword evil-class">x</span>');

    expect(html).toContain('class="hljs-keyword"');
    expect(html).not.toContain('evil-class');
  });

  it('保留 language-* / mermaid / katex* 类', () => {
    const html = sanitizePostHtml(
      '<code class="language-c++">a</code><div class="mermaid">b</div><span class="katex katex-html">c</span>',
    );

    expect(html).toContain('class="language-c++"');
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('class="katex katex-html"');
  });

  it('丢弃 Tailwind 覆盖层类名，避免正文构造全屏遮罩', () => {
    const html = sanitizePostHtml('<div class="fixed inset-0 z-50">覆盖</div>');

    expect(html).toContain('<div>覆盖</div>');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('inset-0');
  });

  it('hljs 复合类只保留 hljs-* 部分（hljs-title function_ → hljs-title）', () => {
    const html = sanitizePostHtml('<span class="hljs-title function_">f</span>');

    expect(html).toContain('class="hljs-title"');
    expect(html).not.toContain('function_');
  });

  it('class 值整体不合规时移除属性', () => {
    const html = sanitizePostHtml('<span class="a b c">x</span>');

    expect(html).toBe('<span>x</span>');
  });

  it('保留 KaTeX 排版 style，剥离其余 style 声明', () => {
    const html = sanitizePostHtml(
      '<span style="height:2.7em;vertical-align:-0.15em;position:fixed;background:red">x</span>',
    );

    expect(html).toContain('style="height:2.7em;vertical-align:-0.15em"');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('background');
  });

  it('style 值出现 url()/expression()/转义时整条丢弃', () => {
    const evil = [
      '<span style="background-image:url(javascript:alert(1))">a</span>',
      '<span style="color:expression(alert(1))">b</span>',
      '<span style="width:1em\\;position:fixed">c</span>',
    ].join('');

    const html = sanitizePostHtml(evil);

    expect(html).not.toContain('url(');
    expect(html).not.toContain('expression');
    expect(html).not.toContain('position:fixed');
  });

  it('style 属性被整段过滤后不再输出空 style', () => {
    const html = sanitizePostHtml('<span style="position:fixed">x</span>');

    expect(html).toBe('<span>x</span>');
  });

  it('title 里含 ">" 时后续 class 仍会被过滤', () => {
    const html = sanitizePostHtml('<a title="a>b" class="evil">x</a>');

    expect(html).toContain('title="a>b"');
    expect(html).not.toContain('class=');
  });
});

describe('健壮性', () => {
  it('空字符串 / 纯空白返回空串', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\t  ')).toBe('');
    expect(renderMarkdown(undefined as unknown as string)).toBe('');
    expect(renderMarkdown(null as unknown as string)).toBe('');
  });

  it('超长输入不抛错且仍完成渲染', () => {
    const longParagraph = 'a'.repeat(200_000);
    const html = renderMarkdown(`${longParagraph}\n\n\`\`\`js\nconst x = 1;\n\`\`\``);

    expect(html.length).toBeGreaterThan(100_000);
    expect(html).toContain('<pre><code class="hljs language-js">');
  });

  it('TOC 依赖无属性 h2/h3（目录正则才能匹配）', () => {
    const html = renderMarkdown('## 一级标题\n\n### 二级标题\n\n正文');

    expect(html).toContain('<h2>一级标题</h2>');
    expect(html).toContain('<h3>二级标题</h3>');
    expect(html).not.toMatch(/<h[23] [^>]*>/);
  });
});

describe('共用 sanitizeHtml 未被放宽', () => {
  it('评论等共用的 sanitizeHtml 仍然剥离 class', () => {
    const html = sanitizeHtml('<span class="hljs-keyword">x</span>');

    expect(html).toContain('<span>x</span>');
    expect(html).not.toContain('class=');
  });
});

describe('renderMarkdown - 标题层级', () => {
  it('把 Markdown 的一级标题降级为 h2，避免被净化白名单剥成裸文本', () => {
    const html = renderMarkdown('# 一级标题\n\n## 二级标题');
    expect(html).toContain('<h2>一级标题</h2>');
    expect(html).toContain('<h2>二级标题</h2>');
    expect(html).not.toContain('<h1');
  });
});
