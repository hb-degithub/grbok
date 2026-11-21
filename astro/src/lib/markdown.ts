/**
 * 文章正文 Markdown → HTML 渲染管线。
 *
 * 同构约束：SSR（Astro 服务端 / vitest node 环境）与浏览器都能直接调用。
 * 因此这里只使用三方库（marked / highlight.js / katex / isomorphic-dompurify），
 * 不引入 `node:` 内置模块，也不使用 top-level await。
 *
 * 数据来源：`posts.content` 是 Markdown 文本；历史上这段内容被 `sanitizeHtml`
 * 直接当 HTML 输出，导致正文显示成纯文本。本模块负责：
 *   1. GFM Markdown 解析（表格、删除线、自动链接）；
 *   2. 围栏代码块 → highlight.js 高亮（`<pre><code class="hljs language-xxx">`）；
 *   3. ```mermaid 围栏 → `<div class="mermaid">`（服务端只放源码，客户端岛屿渲染）；
 *   4. `$...$` / `$$...$$` → KaTeX（`output: 'html'`，失败保留原文）；
 *   5. 原始 HTML 继续透传（兼容既有文章里手写的 HTML）；
 *   6. 最后统一走 `sanitizePostHtml`：在 `security.ts` 的共用白名单基础上追加
 *      正文所需标签，并对 class / style 做白名单过滤。
 *
 * 注意：不要把 `sanitizeHtml`（评论等共用）的白名单放宽——文章正文用独立函数。
 */
import { Marked } from 'marked';
import type { TokenizerAndRendererExtension, Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * 按需注册的语言集合。
 *
 * 不 `import hljs from 'highlight.js'`：那会把全部 ~190 种语言（约 1MB）打进
 * 服务端模块和后台「预览」的客户端包。这里只注册技术博客常见语言，
 * 未注册的语言按「未知语言」退化为纯转义（不会报错，只是没有 token 颜色）。
 * 新增语言时同时补 `LANGUAGE_ALIASES` 里的别名映射即可。
 */
const HIGHLIGHT_LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  markdown: markdownLanguage,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
} as const;

for (const [name, definition] of Object.entries(HIGHLIGHT_LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** 常见别名 → 已注册语言（highlight.js 的部分别名依赖全量包，core 下需显式补齐）。 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  yml: 'yaml',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  docker: 'dockerfile',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  htm: 'xml',
  toml: 'ini',
  conf: 'ini',
};
import katex from 'katex';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import isomorphicDOMPurify from 'isomorphic-dompurify';

/* -------------------------------------------------------------------------- */
/* 基础工具                                                                    */
/* -------------------------------------------------------------------------- */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 把普通文本转义成可安全内嵌到 HTML 的文本（代码块 / mermaid 源码 / 公式回退）。 */
function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/* -------------------------------------------------------------------------- */
/* 数学公式（KaTeX）                                                           */
/* -------------------------------------------------------------------------- */

/** KaTeX 失败时保留原文，最多接受这么长的公式源码，避免正文里滥用 `$`。 */
const MAX_MATH_SOURCE_LENGTH = 2000;

const KATEX_OPTIONS = { throwOnError: false, output: 'html' } as const;

/**
 * 渲染单条公式。
 *
 * - 使用 `throwOnError: false`：KaTeX 不抛错，而是输出带 `katex-error` 的错误节点；
 *   此时按需求「保留原文」，返回转义后的 `$...$` 源码，而不是把 KaTeX 的错误提示
 *   塞进正文。
 * - 其他异常（非法选项、极端输入）同样退化为原文。
 * - `displayMode` 决定是否整行展示；KaTeX 自己会输出 `.katex-display` 容器。
 */
function renderMathToHtml(tex: string, displayMode: boolean): string {
  const source = String(tex ?? '').trim();
  if (!source) return '';
  const original = displayMode ? `$$${source}$$` : `$${source}$`;
  try {
    const html = katex.renderToString(source, { ...KATEX_OPTIONS, displayMode });
    if (html.includes('katex-error')) return escapeHtml(original);
    return displayMode ? `${html}\n` : html;
  } catch {
    return escapeHtml(original);
  }
}

interface MathToken extends Tokens.Generic {
  type: 'inlineMath' | 'blockMath';
  text: string;
  display: boolean;
}

/** 块级公式：以 `$$` 开始一个块，支持多行。 */
const blockMathExtension: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start(src: string) {
    const index = src.search(/^[ \t]*\$\$/m);
    return index >= 0 ? index : undefined;
  },
  tokenizer(src: string) {
    const match = /^[ \t]*\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (!match) return undefined;
    const text = match[1].trim();
    if (!text || text.length > MAX_MATH_SOURCE_LENGTH) return undefined;
    return { type: 'blockMath', raw: match[0], text, display: true };
  },
  renderer(token: Tokens.Generic) {
    return renderMathToHtml((token as MathToken).text, true);
  },
};

/**
 * 行内公式：
 *   - `$$...$$`（行内但按 display 渲染，兼容既有文章把 `$$` 写在段落里的写法）；
 *   - `$...$`：首尾不能是空白、不能跨行、不能是 `$`，避免把「$5 和 $10」这类金额
 *     误当公式；`start` 跳过被反斜杠转义的 `\$`。
 * 代码块 / 行内代码由 marked 的 fence/codespan tokenizer 先行消费，不会进入这里。
 */
const inlineMathExtension: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src: string) {
    const index = src.search(/(?<!\\)\$/);
    return index >= 0 ? index : undefined;
  },
  tokenizer(src: string) {
    const displayMatch = /^\$\$([^\n$]{1,2000}?)\$\$/.exec(src);
    if (displayMatch) {
      const text = displayMatch[1].trim();
      if (!text) return undefined;
      return { type: 'inlineMath', raw: displayMatch[0], text, display: true };
    }
    const inlineMatch = /^\$(?![\s$])([^\n$]{1,2000}?)(?<!\s)\$(?!\$)/.exec(src);
    if (inlineMatch) {
      const text = inlineMatch[1].trim();
      if (!text) return undefined;
      return { type: 'inlineMath', raw: inlineMatch[0], text, display: false };
    }
    return undefined;
  },
  renderer(token: Tokens.Generic) {
    const math = token as MathToken;
    return renderMathToHtml(math.text, math.display);
  },
};

/* -------------------------------------------------------------------------- */
/* 围栏代码块 / Mermaid                                                        */
/* -------------------------------------------------------------------------- */

const MERMAID_LANGUAGE = 'mermaid';
/** 允许出现在 `language-xxx` 类名里的语言标识（c++ / c# / objective-c 等都要保留）。 */
const LANGUAGE_PATTERN = /^[a-z0-9+#_.-]+$/;

/**
 * 围栏代码块渲染。
 *
 * - ```mermaid → 只输出源码容器，真正的渲染交给客户端岛屿（不在 SSR 里跑 mermaid）；
 * - 已知语言 → highlight.js 高亮，输出 `<pre><code class="hljs language-xxx">`；
 * - 未知语言 / 无语言 → 纯转义，避免高亮器把未识别文本当 HTML 注入。
 */
function renderFencedCode({ text, lang }: Tokens.Code): string {
  const rawLanguage = String(lang ?? '').trim().split(/\s+/)[0] ?? '';
  const language = rawLanguage.toLowerCase();

  if (language === MERMAID_LANGUAGE) {
    return `<div class="mermaid">${escapeHtml(text)}</div>\n`;
  }

  const resolvedLanguage = LANGUAGE_ALIASES[language] ?? language;
  if (resolvedLanguage && LANGUAGE_PATTERN.test(language) && hljs.getLanguage(resolvedLanguage)) {
    try {
      const highlighted = hljs.highlight(text, { language: resolvedLanguage, ignoreIllegals: true }).value;
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>\n`;
    } catch {
      // 高亮器自身异常时宁可退回纯文本，也不要把半成品输出拼进正文
    }
  }

  return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>\n`;
}

/* -------------------------------------------------------------------------- */
/* Marked 实例                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 单例 Marked：解析是同步的，`renderMarkdown` 可被并发调用。
 * `gfm: true` 开启表格/删除线/自动链接；`breaks` 保持 CommonMark 默认（单换行不分段），
 * 避免既有文章的软换行被拆成碎段落。
 */
const markdown = new Marked({ gfm: true, breaks: false });

markdown.use({
  renderer: {
    // marked 的默认 code 渲染器会给所有代码块加 `language-xxx`，这里完全接管，
    // 以便 mermaid / 未知语言走不同分支。
    code(token: Tokens.Code) {
      return renderFencedCode(token);
    },
    // 正文不允许出现 h1（页面标题已是唯一 h1，净化白名单也会剥掉 h1 标签）。
    // 直接把 Markdown 的 `#` 降级成 h2：否则标题会被剥成裸文本，和后面的段落混在一起。
    heading(token: Tokens.Heading) {
      const depth = Math.min(Math.max(token.depth, 2), 4);
      return `<h${depth}>${this.parser.parseInline(token.tokens)}</h${depth}>`;
    },
  },
  extensions: [blockMathExtension, inlineMathExtension],
});

/* -------------------------------------------------------------------------- */
/* 净化（文章正文专用）                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 正文标签白名单 = `security.ts` 共用白名单（评论等） + 文章正文新增标签。
 *
 * 为什么不 import `security.ts` 的常量：该文件里的 `ALLOWED_TAGS` / `ALLOWED_ATTRS`
 * 未导出，且 `sanitizeHtml` 是评论、正文共用入口；放宽它会把评论的 XSS 面一起放大。
 * 这里复制一份基础清单并只在本模块追加，评论侧白名单保持原样。
 */
const BASE_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'a', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
  'h2', 'h3', 'h4', 'img', 'hr', 'mark', 'span', 's', 'u', 'del', 'ins', 'sup', 'sub',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption',
];

/** 正文额外允许的标签：mermaid 容器 + KaTeX 可能产出的 MathML。 */
const POST_ONLY_TAGS = [
  'div',
  'math', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace',
  'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot',
  'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd',
  'annotation', 'annotation-xml',
];

const POST_ALLOWED_TAGS = [...BASE_ALLOWED_TAGS, ...POST_ONLY_TAGS];

/** 正文额外允许的属性：`class` / `style` 必须再经白名单过滤（见下）。 */
const POST_ALLOWED_ATTRS = ['href', 'src', 'alt', 'title', 'target', 'rel', 'class', 'style', 'aria-hidden'];

const POST_SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: POST_ALLOWED_TAGS,
  ALLOWED_ATTR: POST_ALLOWED_ATTRS,
  ALLOW_DATA_ATTR: false,
  // KaTeX 会在 `.katex-html` 上输出 aria-hidden，需要保留（否则视觉层与无障碍层错位）
  ALLOW_ARIA_ATTR: true,
  // 白名单之外再显式禁止一层：这些标签即使将来误加进白名单也不该出现
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcset', 'formaction', 'xlink:href'],
};

/** highlight.js token 类（hljs-keyword、hljs-built_in…）。 */
const HLJS_CLASS_PATTERN = /^hljs(?:-[a-z0-9_]+)?$/;
/** 围栏语言类（language-js、language-c++、language-c#）。 */
const LANGUAGE_CLASS_PATTERN = /^language-[a-z0-9+#_.-]+$/;
/** mermaid 容器类。 */
const MERMAID_CLASS_PATTERN = /^mermaid(?:-[a-z0-9_-]+)?$/;
/** KaTeX 外层类（katex、katex-html、katex-display…）。 */
const KATEX_CLASS_PATTERN = /^katex(?:-[a-z0-9_-]+)?$/;
/** KaTeX 尺寸类：size3 / reset-size6 … */
const KATEX_SIZE_CLASS_PATTERN = /^(?:reset-)?size\d{1,2}$/;
/** KaTeX vlist 系列：vlist / vlist-t / vlist-t2 / vlist-r / vlist-s。 */
const KATEX_VLIST_CLASS_PATTERN = /^vlist(?:-[trs])?\d{0,2}$/;

/**
 * KaTeX 内部结构类白名单。
 *
 * 来源：`katex@0.18` 的 `dist/katex.min.css` 里出现的全部 class 选择器，再加上
 * KaTeX 只用于语义、没有对应 CSS 的原子类（mord / mop / mord…）。
 * 这些类本身没有脚本执行能力，但缺失会让公式排版错乱（分数线、尺寸、上下标），
 * 所以必须保留；同时又不放开任意 Tailwind 类（例如 `fixed inset-0` 这类覆盖层）。
 */
const KATEX_INTERNAL_CLASSES = new Set(
  [
    'accent-body accent-full amsrm angl anglpad arraycolsep boldsymbol boxpad brace-center brace-left',
    'brace-right cancel-lap cancel-pad cd-arrow-pad cd-label-left cd-label-right cd-vert-arrow clap',
    'col-align-c col-align-l col-align-r delim-size1 delim-size4 delimcenter delimsizing eqn-num fbox',
    'fcolorbox fleqn fontsize-ensurer frac-line halfarrow-left halfarrow-right hide-tail katex',
    'katex-accent katex-base katex-display katex-fix katex-hdashline katex-hline katex-html',
    'katex-inner katex-mathml katex-newline katex-overlay katex-overline katex-root katex-rule',
    'katex-sizing katex-smash katex-sout katex-stretchy katex-strut katex-tag katex-thinbox',
    'katex-underline katex-vbox katex-version large-op leqno llap mainrm mathbb mathbf mathboldfrak',
    'mathboldsf mathcal mathfrak mathit mathitsf mathnormal mathrm mathscr mathsf mathsfit mathtt',
    'mbin mclose mfrac minner mml-eqn-num mop mopen mord mover mpunct mrel mspace msupsub mtable',
    'mtight mtr-glue mult munder nulldelimiter op-limits op-symbol overline-line pstrut reset-size1',
    'reset-size10 reset-size11 reset-size2 reset-size3 reset-size4 reset-size5 reset-size6',
    'reset-size7 reset-size8 reset-size9 rlap size1 size10 size11 size2 size3 size4 size5 size6 size7',
    'size8 size9 small-op sqrt svg-align textbb textbf textboldfrak textboldsf textfrak textit',
    'textitsf textrm textscr textsf texttt underline-line vertical-separator vlist vlist-r vlist-s',
    'vlist-t vlist-t2 x-arrow x-arrow-pad',
  ]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean),
);

/** 单个 class token 是否允许保留。 */
function isAllowedClassToken(token: string): boolean {
  if (!token) return false;
  if (HLJS_CLASS_PATTERN.test(token)) return true;
  if (LANGUAGE_CLASS_PATTERN.test(token)) return true;
  if (MERMAID_CLASS_PATTERN.test(token)) return true;
  if (KATEX_CLASS_PATTERN.test(token)) return true;
  if (KATEX_SIZE_CLASS_PATTERN.test(token)) return true;
  if (KATEX_VLIST_CLASS_PATTERN.test(token)) return true;
  return KATEX_INTERNAL_CLASSES.has(token);
}

/**
 * 过滤 class 属性：逐 token 白名单校验，未命中的直接丢弃（不保留空属性）。
 * 这一步是「白名单正则限制 class」的落地点——DOMPurify 本身无法按值过滤属性。
 */
function filterClassValue(value: string): string {
  const kept = String(value ?? '')
    .split(/\s+/)
    .filter((token) => isAllowedClassToken(token));
  return kept.join(' ');
}

/**
 * KaTeX 内联样式属性白名单。
 *
 * `output: 'html'` 依赖这些行内样式完成上下标定位、分数线、根号等排版；
 * 全部剥离会让分数/根号错位，所以保留「属性 + 值」双重白名单，而不是整段丢弃。
 */
const ALLOWED_STYLE_PROPERTIES = new Set([
  'height',
  'width',
  'min-width',
  'vertical-align',
  'margin-left',
  'margin-right',
  'padding-left',
  'top',
  'bottom',
  'left',
  'position',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-style',
  'color',
]);

/** 样式值只允许数字/单位/颜色等无副作用字符，禁止 url()/expression()/转义。 */
const SAFE_STYLE_VALUE_PATTERN = /^[-+.#%\w\s]+$/;
const UNSAFE_STYLE_VALUE_PATTERN = /url|expression|javascript|@|\\|[<>{}();:]/i;

function filterStyleValue(value: string): string {
  const kept: string[] = [];
  for (const rawDeclaration of String(value ?? '').split(';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const separator = declaration.indexOf(':');
    if (separator <= 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    if (!propertyValue || propertyValue.length > 64) continue;
    if (!SAFE_STYLE_VALUE_PATTERN.test(propertyValue)) continue;
    if (UNSAFE_STYLE_VALUE_PATTERN.test(propertyValue)) continue;
    // KaTeX 只会用 position:relative；absolute/fixed 可能被用来做覆盖层，直接拒绝
    if (property === 'position' && propertyValue !== 'relative') continue;
    kept.push(`${property}:${propertyValue}`);
  }
  return kept.join(';');
}

/**
 * 匹配一个完整开始标签（含引号内的 `>`）。
 *
 * DOMPurify 输出的是序列化后的 HTML，属性值统一使用双引号；这里用「能识别引号
 * 的属性段」正则，避免 `title="a>b"` 这种值把标签截断、导致后面的 class 逃过过滤。
 */
const HTML_START_TAG_PATTERN = /<[a-zA-Z][^\s/>]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/g;

/** 对已净化的 HTML 再做一次 class / style 值级过滤（只删属性，不新增内容）。 */
function filterPostAttributes(html: string): string {
  return html.replace(HTML_START_TAG_PATTERN, (tag) => {
    let next = tag;

    const classMatch = /\sclass="([^"]*)"/.exec(next);
    if (classMatch) {
      const filtered = filterClassValue(classMatch[1]);
      next = filtered ? next.replace(classMatch[0], ` class="${filtered}"`) : next.replace(classMatch[0], '');
    }

    const styleMatch = /\sstyle="([^"]*)"/.exec(next);
    if (styleMatch) {
      const filtered = filterStyleValue(styleMatch[1]);
      next = filtered ? next.replace(styleMatch[0], ` style="${filtered}"`) : next.replace(styleMatch[0], '');
    }

    return next;
  });
}

type SanitizeFn = (html: string, config: DOMPurifyConfig) => string;

/**
 * SSR 净化器：`isomorphic-dompurify` 的默认导出是「已用 jsdom 初始化好的实例」，
 * 直接用它（与 `security.ts` 保持一致的做法）。初始化失败时绝不返回原始 HTML。
 */
let serverSanitize: SanitizeFn | null = null;
if (typeof window === 'undefined') {
  try {
    const candidate = (isomorphicDOMPurify as unknown as { default?: unknown }).default ?? isomorphicDOMPurify;
    const instance = candidate as { sanitize?: SanitizeFn };
    if (instance && typeof instance.sanitize === 'function') {
      serverSanitize = (html, config) => String(instance.sanitize!(html, config));
    } else {
      console.error('[markdown] isomorphic-dompurify 未暴露 sanitize，正文净化将退化为纯文本');
    }
  } catch (error) {
    console.error('[markdown] SSR DOMPurify 初始化失败，正文净化将退化为纯文本:', error);
  }
}

/**
 * 文章正文专用净化器：浏览器走 DOMPurify，SSR 走 isomorphic-dompurify。
 * 净化后再做 class/style 值级过滤；两路都不可用时退化为转义纯文本（不返回原始 HTML）。
 */
export function sanitizePostHtml(html: string): string {
  const source = typeof html === 'string' ? html : String(html ?? '');
  if (!source) return '';

  let cleaned: string;
  if (typeof window !== 'undefined') {
    cleaned = String(DOMPurify.sanitize(source, POST_SANITIZE_CONFIG));
  } else if (serverSanitize) {
    cleaned = serverSanitize(source, POST_SANITIZE_CONFIG);
  } else {
    return escapeHtml(source);
  }

  return filterPostAttributes(cleaned);
}

/* -------------------------------------------------------------------------- */
/* 对外入口                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 把 `posts.content` 里的 Markdown 渲染成可直接 `set:html` 的 HTML。
 *
 * 纯同步函数（同构），永不抛出：Markdown 解析异常时退化为 `<pre>` 纯文本，
 * 保证文章接口异常也不会让整页 500。
 */
export function renderMarkdown(source: string): string {
  const markdownSource = typeof source === 'string' ? source : source == null ? '' : String(source);
  if (!markdownSource.trim()) return '';

  let html: string;
  try {
    const parsed = markdown.parse(markdownSource, { async: false });
    html = typeof parsed === 'string' ? parsed : '';
  } catch (error) {
    console.error('[markdown] Markdown 解析失败，正文退回纯文本:', error);
    html = `<pre><code class="hljs">${escapeHtml(markdownSource)}</code></pre>`;
  }

  return sanitizePostHtml(html);
}

/**
 * 删除正文开头与文章标题重复的一级标题。
 *
 * 渲染器会把 Markdown 的 `#` 降级成 h2；很多文章第一行就是 `# 标题`，
 * 而详情页顶部已经有唯一 h1 显示同一个标题，正文再出现一次会和页面标题重复。
 * 只处理「第一处标题且文本与标题完全相同」的情况，其它 h2 保持不动。
 */
export function stripDuplicateTitleHeading(html: string, title: string): string {
  const expected = decodeBasicEntities(String(title ?? '')).trim();
  if (!expected) return html;
  const match = /^\s*<h2>([\s\S]*?)<\/h2>\s*/.exec(html);
  if (!match) return html;
  const actual = decodeBasicEntities(match[1].replace(/<[^>]+>/g, '')).trim();
  if (actual !== expected) return html;
  return html.slice(match[0].length);
}

/** 解码标题比较所需的常见实体（marked 会转义 & < > " '）。 */
function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
