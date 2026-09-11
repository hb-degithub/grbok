#!/bin/bash
# 生成服务器端文件清单与 MD5（统一去 CRLF 后计算），排除 .bak 备份
cd /opt/hlydwz-blog/current
for dir in pb_hooks pb_migrations; do
  find $dir -type f \( -name '*.js' -o -name '*.pb.js' \) ! -name '*.bak*' | sort | while read f; do
    h=$(sed 's/\r$//' "$f" | md5sum | cut -d' ' -f1)
    echo "$h  $f"
  done
done
