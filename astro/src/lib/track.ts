// 友链点击上报：sendBeacon 异步发送，不阻塞跳转；尊重 DNT；静默失败。
export function trackLinkClick(target: string): void {
  try {
    if (typeof navigator === 'undefined') return;
    if (navigator.doNotTrack === '1') return;
    const pbBase = import.meta.env.PUBLIC_POCKETBASE_URL || '';
    if (!pbBase) return;
    const body = JSON.stringify({ path: window.location.pathname, event: 'link_click', target });
    navigator.sendBeacon(`${pbBase}/api/track-view`, new Blob([body], { type: 'application/json' }));
  } catch (_) {
    // 上报失败不影响任何功能
  }
}
