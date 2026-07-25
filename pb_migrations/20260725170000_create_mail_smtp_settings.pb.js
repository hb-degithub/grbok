migrate((db) => {
  const dao = new Dao(db);

  function find(name) {
    try { return dao.findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  let col = find("mail_smtp_settings");
  if (!col) {
    col = new Collection({ name: "mail_smtp_settings", type: "base", system: false, schema: [] });
  }

  function ensureField(field) {
    try {
      const existing = col.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    col.schema.addField(new SchemaField(field));
  }

  ensureField({ name: "host", type: "text", required: true, options: { min: null, max: 255, pattern: "" } });
  ensureField({ name: "port", type: "number", required: true, options: { min: 1, max: 65535, noDecimal: true } });
  ensureField({ name: "username", type: "text", required: false, options: { min: null, max: 320, pattern: "" } });
  ensureField({ name: "password_enc", type: "text", required: false, options: { min: null, max: 2000, pattern: "" } });
  ensureField({ name: "from_address", type: "text", required: true, options: { min: null, max: 320, pattern: "" } });
  ensureField({ name: "from_name", type: "text", required: false, options: { min: null, max: 120, pattern: "" } });
  ensureField({ name: "tls_mode", type: "select", required: false, options: { maxSelect: 1, values: ["auto", "implicit", "starttls"] } });
  ensureField({ name: "enabled", type: "bool", required: false, options: {} });
  ensureField({ name: "updated_by", type: "text", required: false, options: { min: null, max: 64, pattern: "" } });

  // 只允许经 hook 内部读写（管理接口走 /api/blog-admin/mail/smtp，带 step-up）
  col.listRule = null;
  col.viewRule = null;
  col.createRule = null;
  col.updateRule = null;
  col.deleteRule = null;
  dao.saveCollection(col);
}, (db) => {
  const dao = new Dao(db);
  try {
    const col = dao.findCollectionByNameOrId("mail_smtp_settings");
    if (col) dao.deleteCollection(col);
  } catch (_) {}
});
