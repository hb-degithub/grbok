# PocketBase 迁移验证

生产 PocketBase 运行在 Linux Docker 镜像 `ghcr.io/muchobien/pocketbase:0.22.21`，所以最终验证应在 Linux 服务器或等价 Docker 环境执行。

## 服务器验证命令

在项目根目录执行：

```bash
bash scripts/verify-pocketbase-migrations-linux.sh
```

脚本会：

1. 创建 `/tmp/blog-pb-migration-verify.*` 临时验证目录。
2. 先用空迁移目录启动一次 `ghcr.io/muchobien/pocketbase:0.22.21`，初始化 PocketBase 系统表。
3. 停止 bootstrap 容器后，用同一个临时 `pb_data` 挂载当前 `pb_migrations`。
4. 再次启动同版本 PocketBase，真实执行项目迁移。
5. 停止临时容器后读取临时 `pb_data/data.db` 的 `_collections` 表。
6. 断言以下安全边界：
   - `public_comments` 是 view collection。
   - `public_comments` 不暴露 `author_email` / `ip_address`。
   - `comments` 不再允许匿名读取 approved 记录。
   - `settings` 只公开白名单 key，写入仅限 `super_admin`。
   - `post_tags` 的 author 写入受 `post_id.author.id = @request.auth.id` 约束。
7. 清理临时容器和临时数据目录。

成功时会输出：

```text
OK PocketBase migrations verified against initialized data.db
```

## 可选环境变量

```bash
POCKETBASE_IMAGE=ghcr.io/muchobien/pocketbase:0.22.21 \
bash scripts/verify-pocketbase-migrations-linux.sh /path/to/repo
```

## 不会修改生产数据

脚本只挂载当前 `pb_migrations` 为只读，并使用新的临时 `pb_data`。它不会连接或修改生产 `blog_pb_data` volume。

## 为什么要先 bootstrap

在全新空数据目录里，PocketBase 0.22.21 会先创建内部系统表，例如 `_collections`。如果直接把项目迁移挂到完全空的数据目录上，第一条 collection 迁移可能早于系统表初始化而失败。生产服务器已有数据目录，本验证脚本用两阶段方式模拟“已有 PocketBase 系统表后应用项目迁移”的真实升级路径。