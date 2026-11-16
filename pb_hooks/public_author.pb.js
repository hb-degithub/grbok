/// <reference path="../pb_data/types.d.ts" />

/**
 * 公开作者名片接口（2026-11-16）
 *
 * 背景：users 集合的 listRule/viewRule 只允许「本人或管理员」读取
 * （`id = @request.auth.id || @request.auth.role = "admin" ...`），
 * 因此匿名 `?expand=author` 恒为空 —— 实测 `GET /api/collections/posts/records?expand=author`
 * 返回 `expand: null`，文章页的作者名/头像一直渲染不出来。
 *
 * 为什么不直接放开 users 规则：那会让匿名者批量枚举全部用户记录（含 role/level/created），
 * 与本次安全修复的口径冲突。这里改为只暴露展示所需的两个字段，且仅限作者/管理角色。
 *
 * 约定：
 * - 只读、匿名可用；返回 { id, name, avatar }，不含 email/role/level 等；
 * - name 为空时回退 username，两者都空则返回空串（前端会跳过渲染）；
 * - 未找到或角色不符一律 404，不区分原因（避免成为用户存在性 oracle）；
 * - 本文件不注册任何写操作。
 */

routerAdd('GET', '/api/public/authors/:id', (c) => {
  const notFound = { code: 404, message: 'Author not found.', data: {} };

  const rawId = String(c.pathParam('id') || '').trim();
  if (!rawId || rawId.length < 6 || rawId.length > 32) return c.json(404, notFound);

  let record;
  try {
    record = $app.dao().findRecordById('users', rawId);
  } catch (_) {
    return c.json(404, notFound);
  }
  if (!record) return c.json(404, notFound);

  const role = String(record.getString('role') || '');
  if (role !== 'author' && role !== 'admin' && role !== 'super_admin') {
    return c.json(404, notFound);
  }

  const displayName = String(record.getString('name') || record.getString('username') || '').slice(0, 60);
  const avatarFile = String(record.getString('avatar') || '');

  const payload = {
    id: record.id,
    name: displayName,
    avatar: avatarFile
      ? '/api/files/users/' + encodeURIComponent(record.id) + '/' + encodeURIComponent(avatarFile)
      : '',
  };

  c.response().header().set('Cache-Control', 'public, max-age=300');
  return c.json(200, payload);
});
