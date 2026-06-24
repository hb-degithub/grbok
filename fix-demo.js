const fs = require('fs');
const path = require('path');

const file = path.join('H:/开发/个人博客', 'astro/src/pages/posts/demo.astro');
let f = fs.readFileSync(file, 'utf8');

f = f.replace('<p>????????????????????????????</p>', '<p>这是一篇用于演示科幻风格博客排版与评论系统的示例文章。整站采用深色太空主题、全息玻璃卡片与青色霓虹光效，旨在提供沉浸式的阅读体验。</p>');
f = f.replace('<li>??????? 3 ??</li>', '<li>深色太空背景与星空动效</li>');
f = f.replace('<li>Realtime ????</li>', '<li>全息玻璃卡片与扫描线动画</li>');
f = f.replace('<li>???????</li>', '<li>响应式网格布局与 3D 网格地面</li>');
f = f.replace('<li>3D ???????</li>', '<li>支持评论与回复的交互系统</li>');
f = f.replace('<p>?????????????????</p>', '<p>你可以在本页底部尝试发表评论，观察新评论的高亮、回复表单展开以及嵌套评论的层级展示效果。</p>');
f = f.replace(/aria-hidden="true">\?<\/span>/g, 'aria-hidden="true">·</span>');

fs.writeFileSync(file, f, 'utf8');
console.log('demo.astro content fixed');
