(function () {
/// <reference path="../pb_data/types.d.ts" />

// Auto-configure SMTP from environment variables on PocketBase startup.
// Only applies settings if SMTP is not already configured via admin UI,
// allowing manual overrides to persist.

(function configureSmtp() {
  const host = ($os.getenv('ALIYUN_SMTP_HOST') || '').trim();
  const port = ($os.getenv('ALIYUN_SMTP_PORT') || '').trim();
  const user = ($os.getenv('ALIYUN_SMTP_USER') || '').trim();
  const pass = ($os.getenv('ALIYUN_SMTP_PASSWORD') || '').trim();
  const fromEmail = ($os.getenv('ALIYUN_FROM_EMAIL') || '').trim();
  const fromName = ($os.getenv('ALIYUN_FROM_NAME') || '').trim();
  const appUrl = ($os.getenv('PUBLIC_SITE_URL') || '').trim() || 'https://hlydwz.com';

  if (!host || !port || !user || !pass) {
    console.log('[smtp] SMTP env vars incomplete, skipping auto-config');
    return;
  }

  try {
    const settings = $app.settings();
    if (settings.smtp && settings.smtp.enabled) {
      console.log('[smtp] SMTP already configured, skipping env var setup');
      return;
    }

    settings.smtp = settings.smtp || {};
    settings.smtp.enabled = true;
    settings.smtp.host = host;
    settings.smtp.port = Number(port) || 465;
    settings.smtp.username = user;
    settings.smtp.password = pass;
    settings.smtp.tls = true;

    settings.meta = settings.meta || {};
    settings.meta.senderAddress = fromEmail || user;
    settings.meta.senderName = fromName || '个人博客';
    settings.meta.appUrl = appUrl;

    // Custom verification email template linking to the frontend page
    settings.meta.verificationTemplate = {
      subject: '请验证你的邮箱地址',
      body: '<!DOCTYPE html>\n'
        + '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>\n'
        + '<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">\n'
        + '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">\n'
        + '<tr><td style="padding:32px 40px;text-align:center;background:linear-gradient(135deg,#0ea5e9,#3b82f6);">'
        + '<h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">胡巴的博客</h1></td></tr>\n'
        + '<tr><td style="padding:32px 40px;">'
        + '<h2 style="margin:0 0 16px;color:#18181b;font-size:20px;">验证你的邮箱地址</h2>'
        + '<p style="margin:0 0 24px;color:#52525b;font-size:15px;line-height:1.6;">'
        + '你好！请点击下方按钮验证你的邮箱地址。验证后你将可以发表评论和使用更多功能。</p>'
        + '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
        + '<a href="{{APP_URL}}/verify-email?token={{TOKEN}}" '
        + 'style="display:inline-block;padding:12px 32px;background-color:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;">验证邮箱</a>'
        + '</td></tr></table>'
        + '<p style="margin:24px 0 0;color:#a1a1aa;font-size:13px;line-height:1.5;">'
        + '如果按钮无法点击，请复制以下链接到浏览器打开：<br>'
        + '<a href="{{APP_URL}}/verify-email?token={{TOKEN}}" style="color:#3b82f6;word-break:break-all;">{{APP_URL}}/verify-email?token={{TOKEN}}</a></p>'
        + '<p style="margin:16px 0 0;color:#a1a1aa;font-size:13px;">此链接有效期为 24 小时。如果你没有注册账户，请忽略此邮件。</p>'
        + '</td></tr>\n'
        + '<tr><td style="padding:20px 40px;text-align:center;border-top:1px solid #e4e4e7;">'
        + '<p style="margin:0;color:#a1a1aa;font-size:12px;">此邮件由系统自动发送，请勿回复。</p></td></tr>\n'
        + '</table></body></html>',
    };

    $app.save(settings);
    console.log('[smtp] Configured from environment variables');
  } catch (err) {
    console.error('[smtp] Auto-config failed:', err);
  }
})();
})();
