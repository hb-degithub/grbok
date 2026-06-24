// ===========================
// PocketBase Hooks 示例
// ===========================
// 文件位置: pb_hooks/send_email_comment.pb.js
// 功能: 新评论创建后发送邮件通知

/// <reference path="../pb_data/types.d.ts" />

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function cleanHeader(value) {
    return String(value ?? "").split("\r").join(" ").split("\n").join(" ").trim();
}

function trimTrailingSlash(value) {
    const text = String(value ?? "");
    return text.endsWith("/") ? text.slice(0, -1) : text;
}

onRecordCreateRequest((e) => {
    e.next();

    const record = e.record;
    const postId = record.get("post_id");
    const authorEmail = cleanHeader(record.get("author_email"));
    const content = record.get("content");

    try {
        const post = $app.findRecordById("posts", postId);
        const postTitle = cleanHeader(post.get("title"));
        const postSlug = cleanHeader(post.get("slug") || postId);
        const authorId = post.get("author");
        let postAuthorEmail = "";

        if (authorId) {
            const author = $app.findRecordById("users", authorId);
            postAuthorEmail = cleanHeader(author.get("email"));
        }

        if (postAuthorEmail && postAuthorEmail !== authorEmail) {
            const appUrl = trimTrailingSlash($app.settings().meta.appUrl || "");
            const postUrl = appUrl + "/posts/" + encodeURIComponent(postSlug);
            const html = [
                '<h2>你的文章 "' + escapeHtml(postTitle) + '" 收到新评论</h2>',
                '<p><strong>评论者:</strong> ' + escapeHtml(authorEmail) + '</p>',
                '<p><strong>评论内容:</strong></p>',
                '<blockquote>' + escapeHtml(content) + '</blockquote>',
                '<hr>',
                '<p><a href="' + escapeHtml(postUrl) + '">查看文章</a></p>',
            ].join('');
            const message = new MailerMessage({
                from: {
                    address: $app.settings().meta.senderAddress,
                    name: $app.settings().meta.senderName,
                },
                to: [{ address: postAuthorEmail }],
                subject: "新评论: " + postTitle,
                html,
            });

            $app.newMailClient().send(message);
            console.log("评论邮件通知已发送给 " + postAuthorEmail);
        }
    } catch (err) {
        console.error("发送评论邮件通知失败:", err);
    }
}, "comments");
