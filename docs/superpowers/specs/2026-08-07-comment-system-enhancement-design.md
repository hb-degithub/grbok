# 评论系统完善设计

## 概述

在现有评论系统基础上，完善 6 个方面：点赞/反应、举报、编辑/删除、通知偏好、分页、搜索。

## 现有系统分析

### 已有功能
- 前端：CommentForm（发表）、ReplyForm（回复）、CommentSection（评论区）、嵌套树形展示
- 后端：comments 集合 + public_comments 视图（只显示已审核）
- 审核：pending/approved/spam 三态，CommentModerator 管理后台
- 通知：邮件通知（新评论通知作者 + 回复通知被回复者）
- 实时：Realtime 订阅新评论
- 安全：限流（IP/邮箱/文章维度）、XSS 过滤

### 数据库 Schema（现有）
```
comments:
  - id, post_id, author_name, author_email, content, parent_id
  - status: pending/approved/spam
  - created, updated
```

## 完善方案

### 1. 评论点赞/反应

**数据库变更**：
- comments 集合新增 `likes` 字段（number，默认 0）

**前端**：
- 每条评论显示点赞按钮 + 数量
- 点击后按钮变为已点赞状态（teal 色）
- 同一 IP 每分钟最多 10 次点赞（前端 RateLimiter）

**后端**：
- 新增 `POST /api/comments/:id/like` 端点
- 限流：`comment_like_ip` 策略桶（10 次/分钟）

### 2. 评论举报

**数据库变更**：
- 新增 `comment_reports` 集合：
  - id, comment_id, reporter_ip, reason, status(pending/reviewed/dismissed)
  - created, updated

**前端**：
- 每条已审核评论显示"举报"按钮
- 点击弹出举报原因输入框
- 提交后显示"举报已提交"

**后端**：
- 新增 `POST /api/comments/:id/report` 端点
- 限流：`comment_report_ip` 策略桶（5 次/10 分钟）
- 举报后通知管理员（邮件）

### 3. 评论编辑/删除

**数据库变更**：
- comments 集合新增：
  - `edited`（bool，默认 false）
  - `edited_at`（date，可空）
  - `deleted`（bool，默认 false）

**前端**：
- 评论显示"编辑"和"删除"按钮（仅自己的评论）
- 编辑需要邮箱验证码验证身份
- 删除为软删除（`deleted: true`），前端不显示
- 编辑后显示"已编辑"标记

**后端**：
- 新增 `POST /api/comments/:id/edit` 端点（需邮箱验证）
- 新增 `POST /api/comments/:id/delete` 端点（需邮箱验证）
- 编辑/删除后更新 `edited`/`edited_at`/`deleted` 字段

### 4. 评论通知偏好

**数据库变更**：
- users 集合新增 `notify_comment_reply` 字段（bool，默认 true）

**前端**：
- 评论表单中添加"接收回复通知"复选框（默认勾选）
- 用户设置页面添加通知偏好开关

**后端**：
- 回复通知时检查被回复者的 `notify_comment_reply` 偏好
- 如果为 false，跳过邮件通知

### 5. 评论分页

**前端**：
- 每页 20 条评论，"加载更多"按钮
- 按时间倒序排列（最新在前）
- 回复评论跟随父评论分页

**后端**：
- `getPublicComments` 支持分页参数（page, perPage）
- 返回 `totalItems` 和 `totalPages`

### 6. 评论搜索

**前端**：
- CommentModerator 添加搜索框
- 支持按作者名/邮箱/内容/文章标题搜索
- 实时搜索（防抖 300ms）

**后端**：
- `getComments` 支持 `query` 参数
- 使用 PocketBase 的 `~` 操作符进行模糊匹配

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `pb_migrations/20260807130000_enhance_comments.pb.js` | 新增 | 数据库迁移（likes/edited/deleted/notify_comment_reply/comment_reports） |
| `pb_hooks/lib/comment_like.pb.js` | 新增 | 点赞端点 |
| `pb_hooks/lib/comment_report.pb.js` | 新增 | 举报端点 |
| `pb_hooks/lib/comment_edit.pb.js` | 新增 | 编辑/删除端点 |
| `astro/src/lib/services/commentService.ts` | 修改 | 分页/点赞/举报/编辑/删除 API |
| `astro/src/components/comments/CommentItem.tsx` | 修改 | 点赞按钮/举报按钮/编辑/删除 |
| `astro/src/components/comments/CommentSection.tsx` | 修改 | 分页/加载更多 |
| `astro/src/components/admin/CommentModerator.tsx` | 修改 | 搜索框 |
| `astro/src/hooks/useComments.ts` | 修改 | 分页逻辑 |

## 约束

- 零新 npm 依赖
- 所有新端点需要限流保护
- 编辑/删除需要邮箱验证码验证身份
- 举报后通知管理员
- 分页默认每页 20 条
