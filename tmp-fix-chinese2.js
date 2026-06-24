const fs = require('fs');
const base = 'H:/开发/个人博客';

// Header.tsx
let header = fs.readFileSync(`${base}/astro/src/components/layout/Header.tsx`, 'utf8');
header = header.replace('aria-label="导航栏组件"', 'aria-label="主导航"');
header = header.replace('aria-label="设计决策："', 'aria-label="返回博客首页"');
header = header.replace('玻璃顶栏：半透明', '博客');
fs.writeFileSync(`${base}/astro/src/components/layout/Header.tsx`, header, 'utf8');

// AuthPage.tsx
let auth = fs.readFileSync(`${base}/astro/src/components/auth/AuthPage.tsx`, 'utf8');
auth = auth.replace('认证页面主组件', '欢迎来到博客');
auth = auth.replace('设计决策：', '分享技术、思考与生活');
auth = auth.replace('全屏', '返回首页');
fs.writeFileSync(`${base}/astro/src/components/auth/AuthPage.tsx`, auth, 'utf8');

// PostList.tsx
let pl = fs.readFileSync(`${base}/astro/src/components/posts/PostList.tsx`, 'utf8');
pl = pl.replace('aria-label="骨架屏卡片"', 'aria-label="加载中"');
pl = pl.replace('占位', '加载失败，请稍后重试');
pl = pl.replace('文章列表组件', '重试');
pl = pl.replace('设计决策：加载', '暂无文章');
fs.writeFileSync(`${base}/astro/src/components/posts/PostList.tsx`, pl, 'utf8');

// SearchModal.tsx
let sm = fs.readFileSync(`${base}/astro/src/components/search/SearchModal.tsx`, 'utf8');
sm = sm.replace("console.error('设计决策：:', err)", "console.error('搜索失败:', err)");
sm = sm.replace('          ?K', '          ⌘K');
sm = sm.replace('aria-label="容器"', 'aria-label="搜索"');
sm = sm.replace('aria-label="毛玻璃遮罩，与整站玻璃语言一致。"', 'aria-label="搜索文章"');
sm = sm.replace('placeholder="无障碍：采用..."', 'placeholder="搜索文章..."');
sm = sm.replace('aria-label="模式——"', 'aria-label="关闭搜索"');
sm = sm.replace("'，结果列表为'", "'正在搜索'");
sm = sm.replace("'，'", "'未找到相关结果'");
sm = sm.replace('`每条结果为 ${results.length} 并带`', '`找到 ${results.length} 条结果`');
sm = sm.replace('<div className="py-8 text-center text-sm text-dim">，</div>', '<div className="py-8 text-center text-sm text-dim">未找到相关结果</div>');
sm = sm.replace('<div className="py-8 text-center text-sm text-dim">跟踪键盘高亮项，</div>', '<div className="py-8 text-center text-sm text-dim">输入关键词开始搜索</div>');
sm = sm.replace("{result.title || '屏幕阅读器可正确播报导航。空'}", "{result.title || '无标题'}");
sm = sm.replace('<span>无结果态用 播报。</span>', '<span>未找到相关结果</span>');
sm = sm.replace('<span>? 动态加载</span>', '<span>↻ 动态加载</span>');
sm = sm.replace('<span className="hidden sm:inline">Search</span>', '<span className="hidden sm:inline">搜索...</span>');
fs.writeFileSync(`${base}/astro/src/components/search/SearchModal.tsx`, sm, 'utf8');

console.log('all Chinese text fixed');