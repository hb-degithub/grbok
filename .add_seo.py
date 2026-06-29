# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
p = Path("astro/src/components/admin/PostManager.tsx")
t = p.read_text("utf-8")

# Add SEO fields after the tag selector section, before stats card
# Find the tag selector area
old_tag_end = '</span>\n                    </div>\n                  </div>\n                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs text-text-secondary">'
new_tag_end = '</span>\n                    </div>\n                  </div>\n\n                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs">\n                    <div className="mb-2 font-mono text-[10px] uppercase text-text-secondary">SEO / </div>\n                    <div className="flex flex-wrap gap-2 mb-2">\n                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text">\n                        <input type="checkbox" checked={editing.is_pinned || false} onChange={(e) => setEditing({ ...editing, is_pinned: e.target.checked })} className="h-3.5 w-3.5 rounded border-border accent-accent" />\n                        <span className="text-xs"></span>\n                      </label>\n                      <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary hover:text-text">\n                        <input type="checkbox" checked={editing.is_featured || false} onChange={(e) => setEditing({ ...editing, is_featured: e.target.checked })} className="h-3.5 w-3.5 rounded border-border accent-accent" />\n                        <span className="text-xs"></span>\n                      </label>\n                    </div>\n                    <input type="text" value={(editing as any).seo_title || ''} onChange={(e) => setEditing({ ...editing, seo_title: e.target.value } as any)} placeholder="SEO ..." className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />\n                    <input type="text" value={(editing as any).seo_description || ''} onChange={(e) => setEditing({ ...editing, seo_description: e.target.value } as any)} placeholder="SEO ..." className="mb-2 min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />\n                    <input type="text" value={(editing as any).seo_keywords || ''} onChange={(e) => setEditing({ ...editing, seo_keywords: e.target.value } as any)} placeholder="SEO ..." className="min-h-9 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent" />\n                  </div>\n\n                  <div className="rounded-md border border-border bg-bg-soft p-3 text-xs text-text-secondary">'
t = t.replace(old_tag_end, new_tag_end)

p.write_text(t, "utf-8")
print("SEO fields added")
print("Has is_pinned:", "is_pinned" in p.read_text("utf-8"))
