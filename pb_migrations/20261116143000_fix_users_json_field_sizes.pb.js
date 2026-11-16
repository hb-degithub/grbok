/// <reference path="../pb_data/types.d.ts" />

// #31（生产已确认）：users 的 stats / level_config / level_history 三个 JSON 字段
// 在 20260808120000_add_user_levels.pb.js 里创建时没有 options，PocketBase 0.22 因此
// 把 jsonFieldOptions.MaxSize 解析成 0，保存记录时 JSON 校验直接失败：
//   validation_json_size_limit: The maximum allowed JSON size is 0 bytes.
// 结果：任何 PATCH /api/collections/users/records/<id>（只改 bio、空 body、multipart
// 头像上传）都返回 400 且写入未发生，管理端 UserManager 整体不可用。
//
// 本迁移只做一件事：把这三个**已存在**字段的 options.maxSize 设为 200000
// （与 settings.value 同量级），并保留原字段 id —— 不重建数据列、不动既有 JSON 内容。
// 幂等：重复执行只是把同样的 maxSize 再写一遍，不报错；字段缺失时按同一规格补建。
//
// 注意：PocketBase 迁移脚本不使用原生数组高阶方法（map/filter/forEach 等）。

migrate((db) => {
  const dao = new Dao(db);
  const MAX_SIZE = 200000;
  const FIELD_NAMES = ['stats', 'level_config', 'level_history'];

  const users = dao.findCollectionByNameOrId('users');
  if (!users) throw new Error('users collection is required');

  for (let i = 0; i < FIELD_NAMES.length; i++) {
    const name = FIELD_NAMES[i];
    let existing = null;
    try {
      existing = users.schema.getFieldByName(name);
    } catch (_) {
      existing = null;
    }
    // 沿用既有字段 id ⇒ 字段元数据不变，只有 options.maxSize 生效。
    users.schema.addField(new SchemaField({
      id: existing && existing.id ? existing.id : '',
      name: name,
      type: 'json',
      required: false,
      options: { maxSize: MAX_SIZE },
    }));
  }

  dao.saveCollection(users);
}, (db) => {
  // down：**故意空操作，不把 maxSize 恢复成 0**。
  // 0 就是 #31 的故障态：任何 users 保存都会被 JSON 校验拦成 400，
  // 静默回滚等于重新打断用户资料、后台用户管理全部写路径。
  // 真正的回滚方式是恢复变更前的 pb_data 备份并重启容器（见 AGENTS.md §4）。
});
