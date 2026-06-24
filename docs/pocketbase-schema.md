# PocketBase 数据模型设计

## 📊 Collections 概览

| Collection | 用途 | 类型 |
|------------|------|------|
| `users` | 用户（博主 + 读者） | Auth |
| `posts` | 文章 | Base |
| `comments` | 评论 | Base |
| `tags` | 标签 | Base |
| `post_tags` | 文章-标签关联 | Base |
| `settings` | 站点设置 | Base |

---

## 1. users (Auth Collection)

系统自带，扩展以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | text | ✅ | 显示名称 |
| `avatar` | file | ❌ | 头像 (512KB, jpg/png/webp) |
| `role` | select | ✅ | 角色: `admin` / `author` / `reader` |
| `bio` | text | ❌ | 个人简介 |

### 规则
- **List rule**: `id = @request.auth.id || role = "admin"`
- **View rule**: `id = @request.auth.id || role = "admin"`
- **Create rule**: 任何人可注册
- **Update rule**: `id = @request.auth.id`
- **Delete rule**: `id = @request.auth.id || role = "admin"`

---

## 2. posts (Base Collection)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | text | ✅ | 文章标题 |
| `slug` | text | ✅ | URL 友好的唯一标识 |
| `content` | editor | ✅ | 文章内容（富文本） |
| `excerpt` | text | ❌ | 摘要（用于列表展示） |
| `cover` | file | ❌ | 封面图 (2MB, jpg/png/webp) |
| `status` | select | ✅ | 状态: `draft` / `published` / `archived` |
| `author` | relation | ✅ | 作者 → users |
| `published_at` | datetime | ❌ | 发布时间 |
| `views` | number | ❌ | 浏览次数（默认 0） |

### 规则
- **List rule**: `status = "published" || author.id = @request.auth.id`
- **View rule**: `status = "published" || author.id = @request.auth.id`
- **Create rule**: `@request.auth.id != "" && author.id = @request.auth.id`
- **Update rule**: `author.id = @request.auth.id || @request.auth.role = "admin"`
- **Delete rule**: `author.id = @request.auth.id || @request.auth.role = "admin"`

### 索引
- `slug` (unique)
- `status` + `published_at` (复合索引)
- `author` (关联索引)

---

## 3. comments (Base Collection)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `post_id` | relation | ✅ | 所属文章 → posts |
| `author_name` | text | ✅ | 评论者昵称 |
| `author_email` | email | ✅ | 评论者邮箱 |
| `content` | text | ✅ | 评论内容 |
| `parent_id` | relation | ❌ | 父评论 → comments（支持嵌套） |
| `status` | select | ✅ | 状态: `pending` / `approved` / `spam` |
| `ip_address` | text | ❌ | 评论者 IP（用于反垃圾） |

### 规则
- **List rule**: `status = "approved" || @request.auth.role = "admin"`
- **View rule**: `status = "approved" || @request.auth.role = "admin"`
- **Create rule**: 任何人可评论（需填写昵称和邮箱；前端默认写入 `pending`）
- **Update rule**: `@request.auth.role = "admin"`
- **Delete rule**: `@request.auth.role = "admin"`

### 隐私字段
- `author_email`、`ip_address` 只能给后台管理员使用；匿名公开接口不得返回这两个字段。
- 当前前端查询已使用 `fields` 只读取公开评论字段；生产环境仍应在 PocketBase 侧使用字段隐藏、公开只读 View collection 或服务端代理二次过滤，避免用户直接调用 API 读取敏感字段。

### 索引
- `post_id` + `status` (复合索引)
- `parent_id` (嵌套查询)
- `author_email` (反垃圾查询)

---

## 4. tags (Base Collection)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | text | ✅ | 标签名称 |
| `slug` | text | ✅ | URL 友好的唯一标识 |
| `description` | text | ❌ | 标签描述 |

### 规则
- **List rule**: 任何人可查看
- **View rule**: 任何人可查看
- **Create rule**: `@request.auth.role = "admin" || @request.auth.role = "author"`
- **Update rule**: `@request.auth.role = "admin"`
- **Delete rule**: `@request.auth.role = "admin"`

### 索引
- `slug` (unique)
- `name` (unique)

---

## 5. post_tags (Base Collection)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `post_id` | relation | ✅ | 文章 → posts |
| `tag_id` | relation | ✅ | 标签 → tags |

### 规则
- **List rule**: 任何人可查看
- **View rule**: 任何人可查看
- **Create rule**: `@request.auth.role = "admin" || @request.auth.role = "author"`
- **Update rule**: `@request.auth.role = "admin"`
- **Delete rule**: `@request.auth.role = "admin"`

### 索引
- `post_id` + `tag_id` (unique compound)

---

## 6. settings (Base Collection)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | text | ✅ | 设置键名 |
| `value` | json | ✅ | 设置值（JSON 格式） |
| `description` | text | ❌ | 设置说明 |

### 预设配置项

```json
[
  { "key": "site_title", "value": "\"我的博客\"", "description": "站点标题" },
  { "key": "site_description", "value": "\"个人博客\"", "description": "站点描述" },
  { "key": "site_logo", "value": "\"\"", "description": "站点 Logo URL" },
  { "key": "posts_per_page", "value": "10", "description": "每页文章数" },
  { "key": "enable_comments", "value": "true", "description": "是否启用评论" },
  { "key": "comment_moderation", "value": "true", "description": "评论是否需要审核" },
  { "key": "analytics_id", "value": "\"\"", "description": "Google Analytics ID" }
]
```

### 规则
- **List rule**: 任何人可查看
- **View rule**: 任何人可查看
- **Create rule**: `@request.auth.role = "admin"`
- **Update rule**: `@request.auth.role = "admin"`
- **Delete rule**: `@request.auth.role = "admin"`

---

## 🔐 权限总结

| 角色 | 文章 | 评论 | 标签 | 设置 |
|------|------|------|------|------|
| **匿名用户** | 查看已发布 | 创建/查看已审核 | 查看 | 查看 |
| **reader** | 查看已发布 | 创建/查看已审核 | 查看 | 查看 |
| **author** | CRUD 自己的 | 管理 | CRUD | 查看 |
| **admin** | 全部 | 全部 | 全部 | 全部 |

---

## 📝 Admin UI 创建步骤

1. 本地访问 http://localhost:80/_/admin；生产环境必须通过 HTTPS 域名访问
2. 创建管理员账户
3. 进入 Collections 页面
4. 按上述结构依次创建每个 Collection
5. 配置字段、规则和索引
6. 在 settings Collection 中添加预设配置项
