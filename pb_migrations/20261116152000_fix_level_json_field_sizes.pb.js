/// <reference path="../pb_data/types.d.ts" />

// #31 同族修复（2026-11-16 生产已确认）：level_rules.upgrade_conditions、
// level_rules.benefits、user_levels_log.trigger_data 三个 JSON 字段在
// 20260808120000_add_user_levels.pb.js 里创建时没有 options，PocketBase 0.22 因此把
// jsonFieldOptions.MaxSize 解析成 0，任何写这些字段的 API 请求都被拦成 400：
//   validation_json_size_limit: The maximum allowed JSON size is 0 bytes.
// 结果：等级规则的新增/编辑（level_rules）与升级日志写入（user_levels_log）全部失败。
//
// 本迁移做的事情，与 20261116143000_fix_users_json_field_sizes.pb.js 完全同构：
//   1. 只在**显式白名单集合**里遍历 schema（不做全库扫描，避免误伤别的集合）；
//   2. 对每个 type='json' 且 options.maxSize <= 0（或缺失）的字段，
//      沿用原字段 id，把 options.maxSize 补成 200000（与 settings.value / users.stats 同量级）；
//   3. 打印每个集合实际补了哪些字段，便于生产应用时从容器日志核对；
//   4. 幂等：字段已经是 maxSize>0 时整条跳过（不重复 saveCollection）；
//   5. down 为空操作（见文件末尾说明）。
//
// 白名单说明：
//   - level_rules / user_levels_log 由 20260808120000_add_user_levels.pb.js 创建，
//     就是本任务要修的集合；
//   - users 的三个同族字段由 20261116143000_fix_users_json_field_sizes.pb.js 单独负责，
//     本迁移不重复处理（避免两个迁移互相覆盖，也让各自的范围可独立审阅）。
//
// 注意：PocketBase 迁移脚本禁用原生数组高阶方法（map/filter/forEach 等），
// 全部遍历使用 for 循环；collection.schema 在 0.22 JSVM 里没有 length/下标访问
//（实测 collection.schema.length === undefined），因此这里先用 JSON 序列化拿到
// 只读的 schema 快照，再按名字回到 collection.schema 上原地替换同 id 字段。
migrate((db) => {
  const dao = new Dao(db);
  const MAX_SIZE = 200000;
  const COLLECTIONS = ['level_rules', 'user_levels_log'];

  for (let ci = 0; ci < COLLECTIONS.length; ci++) {
    const collectionName = COLLECTIONS[ci];
    let collection = null;
    try {
      collection = dao.findCollectionByNameOrId(collectionName);
    } catch (_) {
      collection = null;
    }
    if (!collection) {
      console.log('[json-maxsize] skip: collection ' + collectionName + ' not found');
      continue;
    }

    let snapshot = null;
    try {
      snapshot = JSON.parse(JSON.stringify(collection));
    } catch (_) {
      snapshot = null;
    }
    const schema = (snapshot && snapshot.schema) || [];
    const patched = [];

    for (let fi = 0; fi < schema.length; fi++) {
      const field = schema[fi];
      if (!field || field.type !== 'json') continue;
      const current = field.options ? field.options.maxSize : undefined;
      // 已有正数上限的字段不动：本迁移只修 maxSize=0/缺失的故障态。
      if (typeof current === 'number' && current > 0) continue;

      let existing = null;
      try {
        existing = collection.schema.getFieldByName(field.name);
      } catch (_) {
        existing = null;
      }
      if (!existing || !existing.id) continue;

      // 沿用既有字段 id 与 required/unique ⇒ 字段元数据不变，只有 options.maxSize 生效；
      // 目标三个字段都是非必填、非唯一，保持原值以免刷新 schema 时改变约束。
      collection.schema.addField(new SchemaField({
        id: existing.id,
        name: String(field.name),
        type: 'json',
        required: Boolean(field.required),
        unique: Boolean(field.unique),
        options: { maxSize: MAX_SIZE },
      }));
      patched[patched.length] = String(field.name) + ' (' + String(current) + ' -> ' + String(MAX_SIZE) + ')';
    }

    if (!patched.length) {
      console.log('[json-maxsize] ' + collectionName + ': no json field with maxSize<=0');
      continue;
    }
    dao.saveCollection(collection);
    console.log('[json-maxsize] ' + collectionName + ': ' + patched.join(', '));
  }
}, (db) => {
  // down：**故意空操作，不把 maxSize 恢复成 0**。
  // 0 就是本迁移要修的故障态：任何写 level_rules.benefits / upgrade_conditions、
  // user_levels_log.trigger_data 的请求都会被 JSON 校验拦成 400。
  // 真正的回滚方式是恢复变更前的 pb_data 备份并重启容器（见 AGENTS.md §4）。
});
