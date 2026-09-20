#!/bin/bash
# 源站 80 端口防火墙预案（2026-09-20 审计，备而不启用）
#
# 背景：CRITICAL 修复已通过"Caddy 按入口端口分流"关闭（公网 :80 管理路径无条件 404，
# 管理面走 127.0.0.1:18081）。本脚本是可选的纵深加固：把源站 80 入方向限制为
# ESA 回源 IP，彻底封死"直连源站伪造 ali-real-client-ip 轮换登录限流/注册垃圾"
# 等残余面（LOW 级）。
#
# 为什么不直接启用：
#   ESA 官方回源 IP 列表仅在控制台"源站防护"功能提供（付费版），第三方列表
#   （如 nekopara.uk 整理）存在节点漂移风险——列表不全 = 部分地区用户 502。
# 启用前置条件（三选一）：
#   a) ESA 控制台开启"源站防护"，抄录官方收敛后的回源 IP 列表填入下方 ESA_IPS；
#   b) 使用第三方列表 + 用本脚本的 sample 模式观察 1-2 周实际回源 IP 交叉验证；
#   c) 阿里云云防火墙用户：直接引用"ESA 回源地址"地址簿（自动同步，无需本脚本）。
#
# 用法：
#   bash origin-firewall-plan.sh sample        # 观察模式：列出当前 :80 的 TCP 来源 IP
#   bash origin-firewall-plan.sh apply         # 应用白名单（ESA_IPS 非空时才允许）
#   bash origin-firewall-plan.sh rollback      # 回滚（删除本脚本添加的规则）
set -euo pipefail

# ── 填入官方 ESA 回源 IP 段（CIDR，逗号或空白分隔）──
ESA_IPS=""

RULE_COMMENT="esa-origin-allowlist"

sample() {
  echo "当前与 :80 建立连接的对端 IP（含 ESA 回源节点与直连扫描器）："
  ss -tn state established '( sport = :80 )' | awk 'NR>1 {print $4}' | cut -d: -f1 | sort | uniq -c | sort -rn
  echo
  echo "提示：在多个时间点运行并交叉比对，出现在 https 请求时段的高频 IP 即 ESA 节点。"
}

apply() {
  [ -n "${ESA_IPS}" ] || { echo "拒绝：ESA_IPS 为空（见脚本头部启用前置条件）"; exit 1; }
  echo "将放行以下来源访问 80 端口，其余新建连接 DROP：${ESA_IPS}"
  read -r -p "确认继续? (yes/no) " ans
  [ "${ans}" = "yes" ] || exit 1
  iptables -N ${RULE_COMMENT} 2>/dev/null || true
  iptables -F ${RULE_COMMENT}
  # 放行回环与已建立连接
  iptables -A ${RULE_COMMENT} -i lo -j ACCEPT
  iptables -A ${RULE_COMMENT} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  for cidr in ${ESA_IPS//,/ }; do
    iptables -A ${RULE_COMMENT} -s "${cidr}" -p tcp --dport 80 -j ACCEPT
  done
  iptables -A ${RULE_COMMENT} -p tcp --dport 80 -j DROP
  iptables -I INPUT -p tcp --dport 80 -j ${RULE_COMMENT}
  echo "已生效。验证：curl -m 5 http://47.115.134.238/ 应超时；https://hlydwz.com/ 应正常。"
  echo "持久化（Alibaba Cloud Linux 8）：service iptables save 或按所用方案持久化。"
}

rollback() {
  iptables -D INPUT -p tcp --dport 80 -j ${RULE_COMMENT} 2>/dev/null || true
  iptables -F ${RULE_COMMENT} 2>/dev/null || true
  iptables -X ${RULE_COMMENT} 2>/dev/null || true
  echo "已回滚。验证：curl -m 5 http://47.115.134.238/ 应恢复连接（ safeline 404 页）。"
}

case "${1:-}" in
  sample) sample ;;
  apply) apply ;;
  rollback) rollback ;;
  *) echo "用法: $0 sample|apply|rollback"; exit 1 ;;
esac
