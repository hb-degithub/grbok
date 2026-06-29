# 涓汉鍗氬绯荤粺

鍩轰簬 Astro + PocketBase 鐨勮嚜鎵樼涓汉鍗氬绯荤粺銆?
## 馃彈锔?鎶€鏈爤

- **鍓嶇 SSG**: Astro (Content Layer API)
- **鍚庣 BaaS**: PocketBase (SQLite + Auth + API)
- **Web Server**: Caddy (鑷姩 HTTPS + 鍙嶅悜浠ｇ悊)
- **閭欢涓户**: msmtp + 闃块噷浜戦偖浠舵帹閫?- **閮ㄧ讲鏂瑰紡**: Docker Compose 缁熶竴缂栨帓

## 馃搧 椤圭洰缁撴瀯

```
涓汉鍗氬/
鈹溾攢鈹€ docker-compose.local.yml    # 鏈湴娴嬭瘯 Docker 閰嶇疆
鈹溾攢鈹€ Caddyfile.local             # 鏈湴娴嬭瘯 Caddy 閰嶇疆
鈹溾攢鈹€ .env.local                  # PocketBase/Caddy 鐜鍙橀噺
鈹溾攢鈹€ .env.astro                  # Astro 鐜鍙橀噺
鈹溾攢鈹€ start-local.sh              # 鍚姩鑴氭湰 (Linux/macOS)
鈹溾攢鈹€ start-local.bat             # 鍚姩鑴氭湰 (Windows)
鈹溾攢鈹€ pb_hooks/                   # PocketBase Hooks
鈹溾攢鈹€ docs/                       # 鏂囨。
鈹斺攢鈹€ astro/                      # Astro 椤圭洰 (Phase 2)
```

## 馃殌 蹇€熷紑濮?
```bash
# Windows
start-local.bat

# Linux/macOS
chmod +x start-local.sh && ./start-local.sh

# 鎴栨墜鍔ㄥ惎鍔?docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

璁块棶 http://localhost:80/_/admin 鍒涘缓绠＄悊鍛樿处鎴?
## 馃摎 鏂囨。

- [PocketBase 鏁版嵁妯″瀷璁捐](docs/pocketbase-schema.md)
- [PocketBase 瀹夊叏瑙勫垯杩佺Щ](docs/apply_security_rules.pb.js) 鈥?棣栨閮ㄧ讲澶嶅埗鍒?`pb_migrations/`
- [OpenResty 鐧诲綍鎺ュ彛闄愭祦](docs/openresty-login-rate-limit.conf) 鈥?鐢熶骇鍏綉鍏ュ彛鍚敤
- [Phase 1 楠岃瘉娓呭崟](PHASE1_VERIFICATION.md)

## 馃敀 瀹夊叏鍔犲浐

鏈」鐩凡鍐呯疆澶氬眰瀹夊叏闃叉姢:

| 灞傜骇 | 闃叉姢 |
|------|------|
| **Caddy** | HSTS / CSP / X-Frame-Options 绛夊畨鍏ㄥご銆佺洰褰曟壂鎻忚矾寰?403銆丄dmin UI IP 鐧藉悕鍗曪紱鏍囧噯 `caddy:2.8.4-alpine` 涓嶅啓 `rate_limit` |
| **OpenResty/1Panel** | 鍏綉鍏ュ彛闄愬埗 `/api/collections/users/auth-with-password`銆乣/api/admins/auth-with-password`銆佺敤鎴?OTP 璇锋眰/鏍￠獙鎺ュ彛 |
| **PocketBase Hooks** | `login_security.pb.js` 淇濇寔绂佺敤锛岄伩鍏嶇櫥褰?400锛涜瘎璁烘湇鍔＄楠岃瘉 + IP 璁板綍銆佽瘎璁洪偖浠堕€氱煡 |
| **鍓嶇** | 鐧诲綍娴忚鍣ㄦ寚绾广€佸鎴风 RateLimiter銆丄dminGuard 鏈嶅姟绔?token 鏍￠獙銆佽瘎璁哄瓧娈电櫧鍚嶅崟 (鎺掗櫎 email/IP) |
| **閮ㄧ讲** | `./security-check.sh` 閮ㄧ讲鍓嶆牎楠屽瘑閽?IP/鍩熷悕閰嶇疆 |

### 鐢熶骇閮ㄧ讲姝ラ

```bash
# 1. 鐢熸垚鍔犲瘑瀵嗛挜
openssl rand -hex 32

# 2. 閰嶇疆 .env (澶嶅埗 .env.example 濉叆鐪熷疄鍊?
cp .env.example .env

# 3. 搴旂敤 PocketBase 瀹夊叏瑙勫垯
cp docs/apply_security_rules.pb.js pb_migrations/

# 4. 鍦ㄥ叕缃?OpenResty/1Panel 绔欑偣鍚敤鐧诲綍鎺ュ彛闄愭祦
# 灏?docs/openresty-login-rate-limit.conf 鐨?limit_req_zone 鏀惧叆 http{}锛?# location 鏀惧叆绔欑偣 server{}锛屽苟鏀惧湪閫氱敤 proxy location 涔嬪墠銆?
# 5. 閮ㄧ讲鍓嶅畨鍏ㄦ牎楠?./security-check.sh

# 6. 鍚姩
docker compose up -d
```
