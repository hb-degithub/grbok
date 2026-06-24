const fs = require('fs');
const path = require('path');

const filePath = path.join('H:', '开发', '个人博客', 'astro', 'src', 'components', 'effects', 'CursorGlow.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Add useRef to import
content = content.replace(
  "import React, { useState, useEffect } from 'react';",
  "import React, { useState, useEffect, useRef } from 'react';"
);

fs.writeFileSync(filePath, content);
console.log('Fixed CursorGlow.tsx import');
