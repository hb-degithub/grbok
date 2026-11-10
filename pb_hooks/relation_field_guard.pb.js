(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 2026-10-14 渗透测试 #1（users 关系字段 filter oracle）+ 2026-11-08 复核修复。
  //
  // 漏洞本质（PB 0.22.48 源码定位）：
  //   - PB 的 filter 解析器会为 `a.b` 形式的字段建 SQL JOIN 直连被关联集合
  //     （resolvers/record_field_resolve_runner.go），**被 join 集合的访问规则
  //     不参与判定**；因此匿名/reader/author 可以用 `posts?filter=author.role=...`
  //     之类的查询枚举 users 字段。
  //   - 公开可读且带 users 关系的入口不止四个：匿名可读的 tags 还能通过
  //     `post_tags_via_tag_id.post_id.author.<field>` 反关系多跳；comments
  //     在 author token 下也能 `post_id.author.<field>`；集合名大小写、
  //     集合 ID、引号+反斜杠转义、sort、fields 都能绕过旧的"精确四集合名 +
  //     简单剥引号 + 允许名单"实现。
  //
  // 现策略（默认拒绝，不再维护集合/关系图白名单）：
  //   1. 仅作用于集合记录读路由（列表/单条视图，route template 匹配）。
  //   2. admin / super_admin（users 角色）与原生 PB admin（c.get('admin')，
  //      即 /api/admins/* 的 superuser token）豁免：后台与运维需要联表查询。
  //      两种认证形态都要识别——原生 admin 没有 authRecord.role。
  //   3. 其余请求（含匿名）在 filter / sort / fields 中出现「标识符 + 点号」
  //      关系路径即 400，与集合是否为公开可读无关。
  //   4. 扫描器感知引号与反斜杠转义（`\"` / `\'` / `\\`），识别 PB 的 `//`
  //      行注释（PB 0.22.48 实测支持；`/* */` 不是合法 filter 语法），并把
  //      小数（`4.5`、`-1.5`、`.5`）排除在关系遍历之外。fields 里公开前端
  //      使用的 `expand.<relation>.<field>` 选择器保留——expand 本身按被展开
  //      集合的 viewRule 授权，不是过滤 oracle。
  //   5. filter/sort/fields 长度上限 1024（PB 自身约 2000 上限，这里 fail-closed
  //      提前拒绝并避免解析成本）；日志只记录集合/参数名/角色，不记录参数值。
  //   6. 集合解析失败时：`no rows`（未知集合）交给 core 返回 404；其他解析
  //      异常 fail-closed 400。
  //   7. **next(c) 只在函数最末尾调用一次，且在所有 try/catch 之外**。
  //      旧实现把 next(c) 放在 try 内：下游返回错误时 JSVM 把 Go error 抛成
  //      JS 异常，catch 于是再次调用 next(c)，同一请求的后续链路执行两次
  //      （实测：计数器 +2；带 body 的路由触发 bodyLimit sync.Pool 重入并
  //      Go fatal stack overflow；登录失败限流双计数）。
  //
  // PB 0.22 JSVM 实测要点（沿用旧实现结论）：
  //   - routerUse 的 handler 必须是「中间件工厂」形状：
  //     `routerUse(function (next) { return function (c) { ...; return next(c); }; })`。
  //   - handler 在请求级 runtime 重新 eval，看不到本文件 IIFE 内的常量/函数，
  //     故全部逻辑自包含。
  //   - `c.path()` 返回路由模板而不是原始 URL；routerUse 只在已注册路由命中后执行。
  //
  // 回滚：删除本文件并重启 PB 即可（无需迁移）。

  routerUse(function (next) {
    return function (c) {
      // ---- 路由识别：只看集合记录列表/单条视图 ---------------------------
      var routePath = '';
      try { routePath = String(c.path() || ''); } catch (_) { routePath = ''; }
      if (routePath !== '/api/collections/:collection/records' &&
          routePath !== '/api/collections/:collection/records/:id') {
        return next(c);
      }

      // ---- 管理豁免：users 角色 + 原生 PB admin 两种形态 -----------------
      var isAdmin = false;
      try {
        if (c.get('admin')) isAdmin = true;
      } catch (_) { isAdmin = false; }
      if (!isAdmin) {
        try {
          var authRecord = c.get('authRecord') || c.get('auth');
          if (authRecord && typeof authRecord.get === 'function') {
            var role = String(authRecord.get('role') || '').trim();
            if (role === 'admin' || role === 'super_admin') isAdmin = true;
          }
        } catch (_) { isAdmin = false; }
      }
      if (isAdmin) return next(c);

      var collection = '';
      try { collection = String(c.pathParam('collection') || ''); } catch (_) { collection = ''; }

      // ---- 扫描器：全部自包含（请求级 runtime） --------------------------
      var MAX_PARAM_LENGTH = 1024;

      function isIdentStart(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
      }
      function isIdentPart(ch) {
        return isIdentStart(ch) || (ch >= '0' && ch <= '9');
      }
      function isDigit(ch) {
        return ch >= '0' && ch <= '9';
      }
      function isSpace(ch) {
        return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
      }
      // 跳过空白与 PB 的 `//` 行注释；PB 0.22.48 实测支持 `//`，不支持 `/* */`。
      function skipTrivia(text, index, length) {
        while (index < length) {
          var ch = text.charAt(index);
          if (isSpace(ch)) { index++; continue; }
          if (ch === '/' && text.charAt(index + 1) === '/') {
            var newline = text.indexOf('\n', index + 2);
            if (newline === -1) return length;
            index = newline + 1;
            continue;
          }
          break;
        }
        return index;
      }
      // fields 里的 expand.<relation>.<field> 是字段选择器（expand 按 viewRule
      // 授权），不是过滤 oracle；消费掉整条点号路径后继续扫描。
      function skipExpandPath(text, index, length) {
        var i = index + 1;
        while (i < length) {
          if (isIdentPart(text.charAt(i))) { i++; continue; }
          if (text.charAt(i) === '.') {
            var next = i + 1;
            while (next < length && isIdentPart(text.charAt(next))) next++;
            if (next > i + 1) { i = next; continue; }
          }
          break;
        }
        return i;
      }
      function hasRelationPath(raw, param) {
        var text = String(raw);
        var length = text.length;
        var i = 0;
        while (i < length) {
          var ch = text.charAt(i);

          // 引号字符串：按反斜杠转义跳转（`\"`、`\'`、`\\`）。
          if (ch === '"' || ch === "'") {
            var quote = ch;
            i++;
            while (i < length) {
              var inner = text.charAt(i);
              if (inner === '\\') { i += 2; continue; }
              if (inner === quote) { i++; break; }
              i++;
            }
            continue;
          }

          // `//` 行注释：注释内容 PB 不解析，不能当作关系表达式。
          if (ch === '/' && text.charAt(i + 1) === '/') {
            var lineEnd = text.indexOf('\n', i + 2);
            if (lineEnd === -1) return false;
            i = lineEnd + 1;
            continue;
          }

          // 标识符 + 点号 = 关系遍历候选（允许中间夹空白/注释）。
          if (isIdentStart(ch)) {
            var start = i;
            while (i < length && isIdentPart(text.charAt(i))) i++;
            var ident = text.substring(start, i);
            var dot = skipTrivia(text, i, length);
            if (dot < length && text.charAt(dot) === '.') {
              if (param === 'fields' && ident === 'expand') {
                i = skipExpandPath(text, dot, length);
                continue;
              }
              return true;
            }
            i = dot;
            continue;
          }

          // 数字（含小数/负数）：`views > 4.5`、`-1.5`、`.5` 不是关系遍历。
          if (isDigit(ch)) {
            while (i < length && isDigit(text.charAt(i))) i++;
            if (text.charAt(i) === '.' && i + 1 < length && isDigit(text.charAt(i + 1))) {
              i++;
              while (i < length && isDigit(text.charAt(i))) i++;
            }
            continue;
          }

          i++;
        }
        return false;
      }

      // ---- 参数检查 ------------------------------------------------------
      var GUARDED_PARAMS = ['filter', 'sort', 'fields'];
      var tooLong = [];
      var suspicious = [];
      for (var p = 0; p < GUARDED_PARAMS.length; p++) {
        var name = GUARDED_PARAMS[p];
        var value = '';
        try { value = String(c.queryParam(name) || ''); } catch (_) { value = ''; }
        if (!value) continue;
        if (value.length > MAX_PARAM_LENGTH) {
          tooLong.push(name);
          continue;
        }
        if (hasRelationPath(value, name)) suspicious.push(name);
      }

      if (!tooLong.length && !suspicious.length) return next(c);

      var blockedMessage = 'Invalid query: relation field traversal is not allowed.';

      if (tooLong.length) {
        try {
          $app.logger().warn(
            '[relation-field-guard] blocked oversized query parameter',
            'collection', collection || '(empty)',
            'params', tooLong.join(',')
          );
        } catch (_) {}
        return c.json(400, {
          code: 400,
          message: 'Invalid query: query parameter is too large.',
          data: {},
        });
      }

      // 未知集合保留 core 404（不把 404 变成守卫 400）；其他解析异常 fail-closed。
      try {
        $app.dao().findCollectionByNameOrId(collection);
      } catch (resolveError) {
        var resolveMessage = String(resolveError && resolveError.message ? resolveError.message : resolveError);
        if (/no rows/i.test(resolveMessage)) return next(c);
        try {
          $app.logger().error('[relation-field-guard] collection resolve failed, blocking fail-closed');
        } catch (_) {}
        return c.json(400, {
          code: 400,
          message: blockedMessage,
          data: {},
        });
      }

      try {
        $app.logger().warn(
          '[relation-field-guard] blocked relation field traversal',
          'collection', collection,
          'params', suspicious.join(','),
          'actorRole', 'anonymous-or-non-admin'
        );
      } catch (_) {}

      return c.json(400, {
        code: 400,
        message: blockedMessage,
        data: {},
      });
    };
  });
})();
