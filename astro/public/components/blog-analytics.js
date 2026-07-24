/**
 * 隐私友好埋点 SDK —— <1KB，无 Cookie，无第三方域名。
 *
 * 展示层归类：⚙️ 后台基建层（纯追踪，无 UI 渲染）
 * 隐私设计：不设 Cookie、不收集 PII、尊重 DNT、sendBeacon 上报
 * 部署方式：在 BaseLayout 中按需引入（不修改现有 BaseLayout）
 *
 * 分支名：infra/privacy-analytics
 *
 * 用法：
 *   <script type="module" src="/components/blog-analytics.js"></script>
 *   或在 BaseLayout head 中追加（增量，不改现有代码）
 *
 * 后端接收端可自托管 Umami/Plausible，或用已有的 /api/track-view 端点。
 */

(function () {
  'use strict';

  // 尊重 Do Not Track（兼容多浏览器实现）
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return;

  var ENDPOINT = '/api/track-event';
  var SESSION_ID = '';
  try {
    SESSION_ID = sessionStorage.getItem('_bid') || '';
    if (!SESSION_ID) {
      SESSION_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('_bid', SESSION_ID);
    }
  } catch (_) {
    // 隐私模式或禁用存储时降级：无 session 追踪但仍可上报匿名事件
    SESSION_ID = 'anon';
  }

  function track(name, props) {
    try {
      var body = JSON.stringify({
        name: name,
        session: SESSION_ID,
        path: location.pathname,
        ref: document.referrer || '',
        ts: Date.now(),
        props: props || {},
      });
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } catch (_) {}
  }

  // 页面浏览（与 BaseLayout 现有 sendBeacon 互补，不重复）
  // 现有 /api/track-view 已覆盖 pageview，此 SDK 聚焦交互事件

  // 核心事件定义
  // 1. 文章阅读完成（滚动到底部）
  var sentScroll = false;
  window.addEventListener('scroll', function () {
    if (sentScroll) return;
    var scrollPct = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
    if (scrollPct >= 0.9) {
      sentScroll = true;
      track('article_read_complete', { title: document.title });
    }
  }, { passive: true });

  // 2. 外链点击
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[href]');
    if (!link) return;
    var href = link.href;
    if (href && link.host !== location.host) {
      track('external_link_click', { url: href, text: (link.textContent || '').trim().slice(0, 60) });
    }
  }, { passive: true });

  // 3. 搜索使用
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && e.target === document.body) {
      track('search_opened', {});
    }
  });

  // 4. 评论提交
  document.addEventListener('submit', function (e) {
    if (e.target.matches('form')) {
      var hasComment = !!e.target.querySelector('#comment-content, [id^="reply-content"]');
      if (hasComment) track('comment_submit', {});
    }
  }, { passive: true });

  // 暴露给外部调用
  window.blogTrack = track;
})();
