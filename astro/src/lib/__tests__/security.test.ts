import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeHtml, isSafeUrl, generateSlug, isValidEmail } from '../security';

describe('sanitizeText', () => {
  it('strips HTML tags and keeps entities encoded (H1 regression)', () => {
    // <script> and </script> tags are stripped, inner text "alert(1)" remains
    expect(sanitizeText('<script>alert(1)</script>hello')).toBe('alert(1)hello');
    // 关键：实体编码不被解码回原始尖括号
    expect(sanitizeText('&lt;img src=x onerror=alert(1)&gt;')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('handles empty input safely', () => {
    expect(sanitizeText('')).toBe('');
    expect(sanitizeText(null as unknown as string)).toBe('');
    expect(sanitizeText(undefined as unknown as string)).toBe('');
  });

  it('preserves normal text', () => {
    expect(sanitizeText('普通中文文字 normal text 123')).toBe('普通中文文字 normal text 123');
  });
});

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    const result = sanitizeHtml('<p>hi</p><script>alert(1)</script>');
    expect(result).not.toContain('script');
    expect(result).toContain('<p>hi</p>');
  });

  it('removes onerror handlers from img', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('preserves allowed tags', () => {
    const result = sanitizeHtml('<p>段落</p><strong>加粗</strong>');
    expect(result).toContain('<p>段落</p>');
    expect(result).toContain('<strong>加粗</strong>');
  });

  it('strips disallowed tags', () => {
    const result = sanitizeHtml('<iframe src="evil"></iframe><p>ok</p>');
    expect(result).not.toContain('iframe');
    expect(result).toContain('<p>ok</p>');
  });

  it('preserves target=_blank links with safe href', () => {
    const result = sanitizeHtml('<a href="https://example.com" target="_blank">link</a>');
    // DOMPurify 保留 target=_blank 且 href 为安全 https URL
    expect(result).toContain('target="_blank"');
    expect(result).toContain('https://example.com');
    // rel 属性是否自动添加取决于 DOMPurify 版本与 SANITIZE_DOM 配置，
    // 此处不强制断言 rel（前端 security.ts 的 ALLOWED_ATTRS 已包含 rel）
  });

  it('blocks javascript: URLs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });
});

describe('isSafeUrl', () => {
  it('blocks javascript: protocol', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('allows https', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
  });

  it('allows http', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
  });

  it('allows mailto', () => {
    expect(isSafeUrl('mailto:test@example.com')).toBe(true);
  });

  it('allows relative URLs', () => {
    expect(isSafeUrl('/posts/1')).toBe(true);
    expect(isSafeUrl('./page')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
  });

  it('rejects empty', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@sub.example.com')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('generateSlug', () => {
  it('handles Chinese characters', () => {
    expect(generateSlug('测试标题')).toBe('测试标题');
  });

  it('handles English', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('handles mixed content', () => {
    expect(generateSlug('Hello World 123')).toBe('hello-world-123');
  });

  it('handles special characters', () => {
    expect(generateSlug('Test!!! @#$ Title')).toBe('test-title');
  });

  it('truncates to 100 chars', () => {
    const long = 'a'.repeat(150);
    expect(generateSlug(long).length).toBeLessThanOrEqual(100);
  });
});
