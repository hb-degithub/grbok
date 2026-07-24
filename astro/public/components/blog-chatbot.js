/**
 * 博客 RAG 助手 Widget —— Web Component (Shadow DOM 完全隔离)
 *
 * 展示层归类：👁️ 用户可见层
 * 隔离方式：Shadow DOM（零污染全局 DOM/CSS）
 * 降级方案：API 失败时显示静态 FAQ
 * 无障碍：role="dialog" + aria-label + 键盘可关闭
 *
 * 用法（在任意 .astro 页面追加，不修改现有 DOM）：
 * <script type="module" src="/components/blog-chatbot.js"></script>
 * <blog-chatbot endpoint="/api/chat" faqs='[{"q":"如何订阅？","a":"访问 /subscribe 页面"}]'></blog-chatbot>
 *
 * 分支名：feat/ai-rag-widget
 */

class BlogChatbot extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.open = false;
    this.loading = false;
    this.messages = [];
  }

  static get observedAttributes() {
    return ['endpoint', 'faqs'];
  }

  connectedCallback() {
    this.endpoint = this.getAttribute('endpoint') || '/api/chat';
    try {
      this.faqs = JSON.parse(this.getAttribute('faqs') || '[]');
    } catch {
      this.faqs = [];
    }
    this.render();
  }

  /** 完整三态：加载态、错误态、空状态 */
  async sendMessage(text) {
    if (!text.trim() || this.loading) return;
    this.messages.push({ role: 'user', content: text });
    this.loading = true;
    this.renderMessages();

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      this.messages.push({
        role: 'assistant',
        content: data.answer || '抱歉，我暂时无法回答这个问题。',
        sources: data.sources || [],
      });
    } catch {
      // 降级：显示静态 FAQ
      this.messages.push({
        role: 'assistant',
        content: '抱歉，助手暂时不可用。以下是常见问题：',
        faqs: this.faqs,
      });
    } finally {
      this.loading = false;
      this.renderMessages();
    }
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          z-index: 9998;
          font-family: -apple-system, system-ui, sans-serif;
        }
        .fab {
          width: 52px; height: 52px;
          border-radius: 50%;
          border: none;
          background: #4f46e5;
          color: white;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(79,70,229,0.35);
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s;
        }
        .fab:hover { transform: scale(1.08); }
        .panel {
          position: absolute;
          bottom: 64px; right: 0;
          width: min(380px, calc(100vw - 2rem));
          height: min(520px, calc(100vh - 8rem));
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15);
          display: none;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid #e4e4e7;
        }
        .panel.open { display: flex; }
        .header {
          padding: 14px 16px;
          background: #4f46e5;
          color: white;
          display: flex; justify-content: space-between; align-items: center;
        }
        .header h3 { margin: 0; font-size: 14px; font-weight: 600; }
        .close {
          background: none; border: none; color: white;
          cursor: pointer; font-size: 20px; line-height: 1;
          padding: 0; width: 28px; height: 28px;
        }
        .messages {
          flex: 1; overflow-y: auto; padding: 12px;
          display: flex; flex-direction: column; gap: 8px;
          background: #fafafa;
        }
        .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
        .msg.user { align-self: flex-end; background: #4f46e5; color: white; }
        .msg.bot { align-self: flex-start; background: #fff; border: 1px solid #e4e4e7; color: #18181b; }
        .msg .sources { margin-top: 6px; font-size: 11px; }
        .msg .sources a { color: #4f46e5; text-decoration: none; }
        .faq-item {
          display: block; padding: 6px 10px; margin-top: 4px;
          background: #f4f4f5; border-radius: 8px; font-size: 12px;
          cursor: pointer; color: #3f3f46;
        }
        .faq-item:hover { background: #e4e4e7; }
        .loading-dots span {
          display: inline-block; width: 6px; height: 6px;
          border-radius: 50%; background: #a1a1aa; margin: 0 1px;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .loading-dots span:nth-child(1) { animation-delay: -0.32s; }
        .loading-dots span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%,80%,100% { transform: scale(0); } 40% { transform: scale(1); } }
        .input-area {
          padding: 10px 12px; border-top: 1px solid #e4e4e7;
          display: flex; gap: 8px; background: #fff;
        }
        .input-area input {
          flex: 1; border: 1px solid #d4d4d8; border-radius: 8px;
          padding: 8px 12px; font-size: 13px; outline: none;
        }
        .input-area input:focus { border-color: #4f46e5; }
        .input-area button {
          background: #4f46e5; color: white; border: none;
          border-radius: 8px; padding: 8px 14px; font-size: 13px;
          cursor: pointer; white-space: nowrap;
        }
        .input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
      </style>
      <button class="fab" part="fab" aria-label="打开博客助手">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </button>
      <div class="panel" role="dialog" aria-label="博客助手对话" aria-modal="false">
        <div class="header">
          <h3>📚 博客助手</h3>
          <button class="close" aria-label="关闭">×</button>
        </div>
        <div class="messages"></div>
        <div class="input-area">
          <input type="text" placeholder="输入你的问题..." aria-label="问题输入" />
          <button type="button" disabled>发送</button>
        </div>
      </div>
    `;

    const fab = this.shadowRoot.querySelector('.fab');
    const panel = this.shadowRoot.querySelector('.panel');
    const close = this.shadowRoot.querySelector('.close');
    const input = this.shadowRoot.querySelector('input');
    const btn = this.shadowRoot.querySelector('.input-area button');

    fab.addEventListener('click', () => {
      this.open = !this.open;
      panel.classList.toggle('open', this.open);
      if (this.open && this.messages.length === 0) {
        this.messages.push({
          role: 'assistant',
          content: '你好！我是博客助手，可以帮你查找文章内容。有什么想问的？',
        });
        this.renderMessages();
      }
      if (this.open) setTimeout(() => input.focus(), 100);
    });

    close.addEventListener('click', () => {
      this.open = false;
      panel.classList.remove('open');
    });

    const submit = () => {
      const text = input.value;
      if (text.trim()) {
        input.value = '';
        btn.disabled = true;
        this.sendMessage(text).finally(() => { btn.disabled = false; });
      }
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    // 初始化输入框按钮状态
    input.addEventListener('input', () => { btn.disabled = !input.value.trim(); });
  }

  renderMessages() {
    const container = this.shadowRoot.querySelector('.messages');
    if (!container) return;

    container.innerHTML = this.messages.map((msg) => {
      if (msg.faqs && msg.faqs.length) {
        const faqHtml = msg.faqs
          .map((f) => `<span class="faq-item" data-q="${this.escape(f.q)}">${this.escape(f.q)}</span>`)
          .join('');
        return `<div class="msg bot">${this.escape(msg.content)}${faqHtml}</div>`;
      }
      const sources = msg.sources?.length
        ? `<div class="sources">引用：${msg.sources.map((s) => `<a href="${this.escape(s.url)}" target="_blank" rel="noopener">${this.escape(s.title)}</a>`).join('、')}</div>`
        : '';
      return `<div class="msg ${msg.role === 'user' ? 'user' : 'bot'}">${this.escape(msg.content)}${sources}</div>`;
    }).join('');

    if (this.loading) {
      container.innerHTML += `<div class="msg bot"><span class="loading-dots"><span></span><span></span><span></span></span></div>`;
    }

    // FAQ 点击
    container.querySelectorAll('.faq-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.sendMessage(el.dataset.q);
      });
    });

    container.scrollTop = container.scrollHeight;
  }

  escape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

customElements.define('blog-chatbot', BlogChatbot);
