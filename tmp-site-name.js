const fs = require('fs');
const path = require('path');

const configPath = path.join('H:', '开发', '个人博客', 'astro', 'src', 'config', 'site.ts');
let config = fs.readFileSync(configPath, 'utf8');

config = config.replace("name: '个人博客'", "name: '胡巴的博客'");
config = config.replace("logoText: 'E'", "logoText: '胡'");

fs.writeFileSync(configPath, config);
console.log('Updated site name to 胡巴的博客');
