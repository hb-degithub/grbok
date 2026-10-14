(function () {
  /// <reference path="../pb_data/types.d.ts" />

  // 2026-10-14 渗透测试 #1（users 关系字段 filter oracle）修复。
  //
  // 结论（本地复现 + PB 源码定位）：
  //   - 四条公开读路径都能联表探测 users 字段：
  //     posts（`author.<f>`）、post_tags（`post_id.author.<f>`）、
  //     reactions（`user_id.<f>` 直连）、public_comments（`post_id.author.<f>`）。
  //   - 根因在 PB Go 侧：apis/record_helpers.go:320 只拦字面 `"@collection."` / `"@request."`，
  //     而 resolvers/record_field_resolve_runner.go:635-662 会为 `a.b` 形式的字段建 SQL JOIN 直连 users，
  //     **被 join 集合的访问规则从不参与判定**。
  //   - 因此**改集合规则无效**（实测把 posts.listRule 改成纯 `status = "published"` 后 oracle 依然命中），
  //     客户端 filter 是 AND 在规则之外、由 join 解析器单独求值的。
  //
  // 修法：路由中间件在**路由匹配之后**（routerUse 是 echo 的 use-middleware，命中注册路由后才执行）
  // 按「路由模板 + pathParam」识别四个集合的记录读接口，再拒绝 filter/sort/fields 中的点号遍历。
  //   - 路由识别用 `c.path()`（模板 `/api/collections/:collection/records`）+ `c.pathParam('collection')`
  //     （PB 已按路由参数解码——`%2570osts` 双编码也会归一为 `posts`），不依赖字面路径匹配，
  //     因此不会被任何百分号编码绕过。
  //   - `c.queryParam(...)` 已做百分号解码，天然覆盖 `author%2Erole` 这类编码变体。
  //   - 剥离引号字面量后再判点号，避免 ISO 时间戳（`created > "2026-01-01T00:00:00.000Z"`）误判。
  //   - admin/super_admin 豁免（后台管理与运维查询）；其余角色（含匿名/reader/author）一律 400。
  //     实测（tmp/guard-probe*）：PB 的鉴权中间件先于此中间件运行，`c.get('authRecord')` 可取到角色。
  //   - 中间件自身异常时 fail open（`next(c)`），避免一个守卫把整站读接口打死。
  //
  // PB 0.22 JSVM 实测要点（tmp/guard-probe*）：
  //   - routerUse 的 handler 必须写成「中间件工厂」形状：
  //     `routerUse(function (next) { return function (c) { ...; return next(c); }; })`；
  //     写成 `routerUse(function (c) { ... })` 会把 `next` 当成 context，导致**每个请求 400**（实测）。
  //   - handler 在独立作用域执行，看不到本文件 IIFE 内的常量/函数，故自包含。
  //   - `c.path()` 返回的是**路由模板**而非原始 URL；按字面路径匹配会全部落空。
  //   - routerUse 只在已注册路由匹配后执行，不会拦到未注册路径的 404。
  //
  // 回滚：删除本文件并重启 PB 即可（无需迁移）。

  routerUse(function (next) {
    return function (c) {
      try {
        var GUARDED_COLLECTIONS = ['posts', 'post_tags', 'reactions', 'public_comments'];
        var GUARDED_PARAMS = ['filter', 'sort', 'fields'];

        // 只匹配「集合记录读」路由模板；列表与单条记录视图都覆盖。
        var routePath = '';
        try { routePath = String(c.path() || ''); } catch (_) { routePath = ''; }
        if (routePath !== '/api/collections/:collection/records' &&
            routePath !== '/api/collections/:collection/records/:id') {
          return next(c);
        }

        var collection = '';
        try { collection = String(c.pathParam('collection') || ''); } catch (_) { collection = ''; }
        var guarded = false;
        for (var i = 0; i < GUARDED_COLLECTIONS.length; i++) {
          if (GUARDED_COLLECTIONS[i] === collection) { guarded = true; break; }
        }
        if (!guarded) return next(c);

        var role = '';
        try {
          var auth = c.get('authRecord') || c.get('auth') || null;
          if (auth && typeof auth.get === 'function') role = String(auth.get('role') || '').trim();
        } catch (_) {
          role = '';
        }
        if (role === 'admin' || role === 'super_admin') return next(c);

        var hits = [];
        for (var p = 0; p < GUARDED_PARAMS.length; p++) {
          var value = '';
          try { value = String(c.queryParam(GUARDED_PARAMS[p]) || ''); } catch (_) { value = ''; }
          if (!value) continue;
          // 剥离引号字面量后再看是否存在「标识符 + 点号」的关系遍历。
          var stripped = value.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
          if (/[A-Za-z0-9_)]\s*\./.test(stripped)) hits.push(GUARDED_PARAMS[p]);
        }
        if (!hits.length) return next(c);

        try {
          $app.logger().warn(
            '[relation-field-guard] blocked relation field traversal',
            'collection', collection,
            'params', hits.join(','),
            'actorRole', role || 'anonymous'
          );
        } catch (_) {}

        return c.json(400, {
          code: 400,
          message: 'Invalid query: relation field traversal is not allowed.',
          data: {},
        });
      } catch (err) {
        try { $app.logger().error('[relation-field-guard] failed open: ' + String(err)); } catch (_) {}
        return next(c);
      }
    };
  });
})();
