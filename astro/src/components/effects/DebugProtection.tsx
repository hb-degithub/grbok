import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSiteSettings } from '../../hooks/useSiteSettings';

const BLOCKED_KEYS = new Set(['F12']);
const TOAST_DURATION_MS = 1800;

function isBlockedShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if (BLOCKED_KEYS.has(event.key)) return true;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j', 'c'].includes(key)) return true;
  if ((event.ctrlKey || event.metaKey) && ['u', 's'].includes(key)) return true;
  return false;
}

export default function DebugProtection() {
  const { settings } = useSiteSettings();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!settings.debug_protection_enabled) return;

    let timer: number | undefined;
    const showNotice = (message: string) => {
      window.clearTimeout(timer);
      setNotice(message);
      timer = window.setTimeout(() => setNotice(''), TOAST_DURATION_MS);
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      showNotice('页面已开启调试干扰');
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBlockedShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      showNotice('调试快捷键已被干扰');
    };

    const onDragStart = (event: DragEvent) => {
      event.preventDefault();
      showNotice('拖拽操作已被限制');
    };

    document.addEventListener('contextmenu', onContextMenu, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('dragstart', onDragStart, { capture: true });
    document.documentElement.dataset.debugProtection = 'enabled';

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('contextmenu', onContextMenu, { capture: true });
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      document.removeEventListener('dragstart', onDragStart, { capture: true });
      delete document.documentElement.dataset.debugProtection;
    };
  }, [settings.debug_protection_enabled]);

  if (!settings.debug_protection_enabled) return null;

  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          className="fixed bottom-5 left-1/2 z-[9999] -translate-x-1/2 rounded-md border border-zinc-700/15 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white shadow-xl shadow-zinc-950/20"
          role="status"
          aria-live="polite"
        >
          {notice}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
