import DOMPurify from 'dompurify';

/** Sanitize HTML for safe rendering */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return html;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p','br','strong','em','a','code','pre','blockquote','ul','ol','li','h3','h4','img','hr'],
    ALLOWED_ATTR: ['href','src','alt','title','target','rel'],
  });
}

/** Strip all HTML tags */
export function sanitizeText(text: string): string {
  // First pass: remove HTML tags
  let cleaned = text.replace(/<[^>]*>/g, '');
  // Second pass: decode common HTML entities
  cleaned = cleaned.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return cleaned.trim();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

export function generateSlug(title: string): string {
  return title.toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 100);
}

/** Client-side rate limiter (token bucket) */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  constructor(maxTokens = 10, refillRate = 1) {
    this.tokens = maxTokens; this.maxTokens = maxTokens;
    this.refillRate = refillRate; this.lastRefill = Date.now();
  }
  tryConsume(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.maxTokens, this.tokens + (now - this.lastRefill) / 1000 * this.refillRate);
    this.lastRefill = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}
