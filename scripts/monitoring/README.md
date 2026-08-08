# 监控告警体系（最小可行版）

部署位置（生产服务器）：
- Gatus 外部探活：/opt/monitoring/gatus/（独立 docker compose，不入博客栈）
- cron 轮询脚本：/opt/hlydwz-blog/scripts/monitor.sh
- 告警日志：/opt/hlydwz-blog/scripts/monitor.log
- 去重状态：/opt/hlydwz-blog/scripts/.monitor-state/

## 组件
1. Gatus：外部探活 https://hlydwz.com/（200 + body 含 <title>）与 /api/health（200），interval 60s，连续 2 次失败触发告警状态；dashboard 仅绑 127.0.0.1:8085；内存限制 128M。
2. monitor.sh（cron 每 5 分钟）：三容器健康、磁盘>80%、可用内存<150M、1Panel-mysql RestartCount 激增（较上次>=3）、站点 HTTP 兜底（连续 2 次轮询失败）。同异常 1 小时去重，正常无输出。

## 告警渠道说明（重要）
服务器当前**无可用邮件通道**：
- 宿主机无 msmtp 命令与 /root/.msmtprc
- blog-admin-auth 容器内 SMTP 配置为占位符（smtp.example.net / ops@example.com / CHANGE_ME...）
已按任务要求降级为【告警日志 + 轮询兜底】：
- monitor.sh 将告警写入 monitor.log
- Gatus 探活状态由 monitor.sh 兜底（curl 直接探测）
- **收件人 RECIPIENT=ops@example.com 为占位符，需用户补充真实收件人**；如需邮件告警，需先配置真实 SMTP，再将 Gatus alerting.custom.enabled 置 true 并配置邮件 provider。

## 部署/维护命令
- 启动 Gatus：cd /opt/monitoring/gatus && docker compose up -d
- 查看 Gatus dashboard：ssh 隧道后访问 http://127.0.0.1:8085
- 手动跑监控：/opt/hlydwz-blog/scripts/monitor.sh
- 查看告警日志：tail -f /opt/hlydwz-blog/scripts/monitor.log
- cron：crontab -l（已追加 */5 * * * * /opt/hlydwz-blog/scripts/monitor.sh）

## 已知问题
- 1Panel-mysql-zIf9 持续 OOM 重启（RestartCount 已达数千，无内存限制），可用内存紧张（约 700MB）；监控已覆盖，建议为 1Panel 容器设置内存限制。
- Gatus 告警通知默认关闭（alerting.custom.enabled: false），仅保留状态机与 dashboard；站点兜底由 monitor.sh 负责。
