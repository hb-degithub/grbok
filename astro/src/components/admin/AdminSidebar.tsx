import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAdminLogout } from '../../hooks/useAdminAuth';
import { cn } from '../../lib/utils';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6', section: 'Main' },
  { href: '/admin/posts', label: 'Posts', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z', section: 'Content' },
  { href: '/admin/comments', label: 'Comments', icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z', section: 'Content' },
  { href: '/admin/tags', label: 'Tags', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z', section: 'Content' },
  { href: '/admin/users', label: 'Users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', section: 'System' },
  { href: '/admin/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', section: 'System' },
  { href: '/admin/security', label: 'Security', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', section: 'System' },
];

export default function AdminSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { logout } = useAdminLogout();
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const sections = [...new Set(navItems.map(i => i.section))];

  return (
    <motion.aside animate={{ width: collapsed ? 64 : 240 }} transition={{ duration: 0.3 }}
      className="fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-bg-soft/90 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        {!collapsed && <span className="font-display text-sm font-bold uppercase tracking-[0.15em] text-text">Admin<span className="text-accent">.</span></span>}
        <button onClick={() => setCollapsed(!collapsed)} className="rounded-md p-1.5 text-text-secondary transition-colors hover:text-accent" aria-label="Toggle sidebar">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'} /></svg>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {sections.map((section) => (
          <div key={section} className="mb-4">
            {!collapsed && <div className="mb-2 px-3 font-mono text-[10px] uppercase tracking-widest text-muted">{section}</div>}
            {navItems.filter(i => i.section === section).map((item) => {
              const active = item.href === '/admin' ? currentPath === '/admin' || currentPath === '/admin/' : currentPath.startsWith(item.href);
              return (
                <a key={item.href} href={item.href} title={collapsed ? item.label : undefined}
                  className={cn('group mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                    active ? 'bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgba(34,211,238,0.2)]' : 'text-text-secondary hover:bg-bg-soft hover:text-text')}>
                  <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} /></svg>
                  {!collapsed && <span>{item.label}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger">
          <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </motion.aside>
  );
}
