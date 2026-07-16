/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);

  function addField(collection, field) {
    collection.schema.addField(new SchemaField(field));
  }

  function makePrivate(collection) {
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;
  }

  const policies = new Collection({
    name: 'security_rate_policies',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(policies, { name: 'key', type: 'text', required: true, options: { min: 1, max: 80, pattern: '^[a-z][a-z0-9_]*$' } });
  addField(policies, { name: 'limit', type: 'number', required: true, options: { min: 1, max: 300, noDecimal: true } });
  addField(policies, { name: 'window_seconds', type: 'number', required: true, options: { min: 60, max: 86400, noDecimal: true } });
  addField(policies, { name: 'version', type: 'number', required: true, options: { min: 1, max: null, noDecimal: true } });
  addField(policies, { name: 'updated_by', type: 'text', required: true, options: { min: 1, max: 100, pattern: '' } });
  addField(policies, { name: 'updated_at', type: 'date', required: true, options: { min: '', max: '' } });
  makePrivate(policies);
  policies.indexes = [
    'CREATE UNIQUE INDEX idx_security_rate_policies_key ON security_rate_policies (key)',
  ];
  dao.saveCollection(policies);

  const buckets = new Collection({
    name: 'security_rate_buckets',
    type: 'base',
    system: false,
    schema: [],
  });
  addField(buckets, { name: 'policy', type: 'text', required: true, options: { min: 1, max: 80, pattern: '^[a-z][a-z0-9_]*$' } });
  addField(buckets, { name: 'subject_hash', type: 'text', required: true, options: { min: 64, max: 64, pattern: '^[a-f0-9]{64}$' } });
  addField(buckets, { name: 'events_json', type: 'text', required: true, options: { min: 2, max: 16384, pattern: '' } });
  addField(buckets, { name: 'expires_at', type: 'date', required: true, options: { min: '', max: '' } });
  makePrivate(buckets);
  buckets.indexes = [
    'CREATE UNIQUE INDEX idx_security_rate_buckets_policy_subject ON security_rate_buckets (policy, subject_hash)',
    'CREATE INDEX idx_security_rate_buckets_expires_at ON security_rate_buckets (expires_at)',
  ];
  dao.saveCollection(buckets);

  const defaults = {
    account_mail_email: [2, 900], account_mail_ip: [5, 900], account_mail_global: [30, 60],
    registration_ip: [3, 3600], registration_ipv6_64: [10, 3600], registration_global: [20, 60],
    admin_test_actor: [3, 3600], admin_test_global: [10, 86400],
    admin_security_write: [5, 3600],
    comment_notification: [60, 60], account_retention_notice: [10, 60], outbound_global: [60, 60],
  };
  const savedPolicies = dao.findCollectionByNameOrId('security_rate_policies');
  const now = new Date().toISOString();
  Object.keys(defaults).forEach((key) => {
    const record = new Record(savedPolicies);
    record.set('key', key);
    record.set('limit', defaults[key][0]);
    record.set('window_seconds', defaults[key][1]);
    record.set('version', 1);
    record.set('updated_by', 'migration');
    record.set('updated_at', now);
    dao.saveRecord(record);
  });
}, (db) => {
  const dao = new Dao(db);
  for (const name of ['security_rate_buckets', 'security_rate_policies']) {
    try {
      dao.deleteCollection(dao.findCollectionByNameOrId(name));
    } catch (_) {}
  }
});
