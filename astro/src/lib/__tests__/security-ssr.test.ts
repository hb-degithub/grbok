// @vitest-environment node
//
// SSR 环境 sanitizeHtml 回归测试(2026-09-18 安全修复):
// 之前 SSR 把 isomorphic-dompurify 已初始化的实例当工厂调用,初始化失败后静默
// 退回正则净化(可被未闭合标签/畸形属性绕过)。本测试在纯 Node 环境(无 window)
// 验证:危险内容必须被可靠清除;净化器不可用时不得返回原始 HTML。
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../security';

describe('sanitizeHtml in SSR (node environment, no window)', () => {
  it('strips event handler from unclosed img tag', () => {
    // 交接证据中的复现样本:畸形 img 曾保留 onerror 并在浏览器解析后执行
    const out = sanitizeHtml('<img src=x onerror=window.__auditExecuted=1//');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('__auditExecuted');
  });

  it('strips event handler with svg/onload bypass format', () => {
    const out = sanitizeHtml('<svg/onload=alert(1)>');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('<svg');
  });

  it('strips script tags entirely', () => {
    const out = sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    expect(out).toContain('safe');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('removes javascript: URLs from links', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('removes data: URLs from images', () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
    expect(out).not.toContain('data:text/html');
  });

  it('preserves legitimate article formatting', () => {
    const input =
      '<p>段落 <strong>加粗</strong> <em>斜体</em> <code>code</code></p>' +
      '<blockquote>引用</blockquote>' +
      '<ul><li>项目一</li><li>项目二</li></ul>' +
      '<h3>小节</h3>' +
      '<a href="https://example.com/post" target="_blank" rel="noopener noreferrer">外链</a>' +
      '<img src="https://img.hlydwz.com/api/files/x/y/z.png" alt="示例" title="图">';
    const out = sanitizeHtml(input);
    expect(out).toContain('<strong>加粗</strong>');
    expect(out).toContain('<blockquote>引用</blockquote>');
    expect(out).toContain('<li>项目一</li>');
    expect(out).toContain('href="https://example.com/post"');
    expect(out).toContain('src="https://img.hlydwz.com/api/files/x/y/z.png"');
    expect(out).toContain('alt="示例"');
  });

  it('keeps relative and anchor URLs', () => {
    const out = sanitizeHtml('<a href="/posts/x">站内</a><a href="#section">锚点</a>');
    expect(out).toContain('href="/posts/x"');
    expect(out).toContain('href="#section"');
  });

  it('never returns raw HTML when given hostile input end-to-end', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<svg><script>alert(1)</script></svg>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<a href="jAvAsCrIpT:alert(1)">x</a>',
      '<math><mtext><script>alert(1)</script></mtext></math>',
      '<p onclick="alert(1)">段落</p>',
    ];
    for (const p of payloads) {
      const out = sanitizeHtml(p);
      expect(out).not.toMatch(/onerror|onload|onclick|srcdoc|javascript:/i);
      expect(out).not.toContain('<script');
      expect(out).not.toContain('<iframe');
    }
  });
});
