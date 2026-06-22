// ===========================
// PocketBase Hooks 示例
// ===========================
// 文件位置: pb_hooks/send_email_comment.pb.js
// 功能: 新评论发送邮件通知（示例）

/// <reference path="../pb_data/types.d.ts" />

// 当新评论创建时触发
onRecordCreateRequest((e) => {
    // 继续原始请求
    e.next();

    const record = e.record;
    const postId = record.get("post_id");
    const authorEmail = record.get("author_email");
    const content = record.get("content");

    // 获取文章信息
    try {
        const post = $app.findRecordById("posts", postId);
        const postTitle = post.get("title");
        const postAuthorEmail = post.get("author_email");

        // 发送邮件通知（需要配置 SMTP）
        if (postAuthorEmail && postAuthorEmail !== authorEmail) {
            const message = new MailerMessage({
                from: {
                    address: $app.settings().meta.senderAddress,
                    name: $app.settings().meta.senderName,
                },
                to: [
                    {
                        address: postAuthorEmail,
                    },
                ],
                subject: `新评论: ${postTitle}`,
                html: `
                    <h2>你的文章 "${postTitle}" 收到新评论</h2>
                    <p><strong>评论者:</strong> ${authorEmail}</p>
                    <p><strong>评论内容:</strong></p>
                    <blockquote>${content}</blockquote>
                    <hr>
                    <p><a href="${$app.settings().meta.appUrl}/posts/${postId}">查看文章</a></p>
                `,
            });

            $app.newMailClient().send(message);
            console.log(`邮件通知已发送给 ${postAuthorEmail}`);
        }
    } catch (err) {
        console.error("发送邮件通知失败:", err);
    }
}, "comments");
