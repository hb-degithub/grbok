/// <reference path="../pb_data/types.d.ts" />

migrate((db) => {
  const dao = new Dao(db);
  const deployedAtMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  function addField(collection, definition) { collection.schema.addField(new SchemaField(definition)); }
  function makePrivate(collection) {
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    collection.updateRule = null;
    collection.deleteRule = null;
  }
  function iso(ms) { return new Date(ms).toISOString(); }

  const users = dao.findCollectionByNameOrId('users');
  const comments = dao.findCollectionByNameOrId('comments');
  const states = new Collection({ name: 'account_retention_state', type: 'base', system: false, schema: [] });
  addField(states, { name: 'user', type: 'relation', required: true, options: { collectionId: users.id, cascadeDelete: true, minSelect: null, maxSelect: 1, displayFields: ['email'] } });
  addField(states, { name: 'cleanup_eligible_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(states, { name: 'reminder_due_at', type: 'date', required: true, options: { min: '', max: '' } });
  addField(states, { name: 'reminder_sent_at', type: 'date', required: false, options: { min: '', max: '' } });
  addField(states, { name: 'reminder_attempts', type: 'number', required: true, options: { min: 0, max: 3, noDecimal: true } });
  addField(states, { name: 'next_attempt_at', type: 'date', required: false, options: { min: '', max: '' } });
  addField(states, { name: 'last_error_class', type: 'text', required: false, options: { min: null, max: 80, pattern: '^[A-Z0-9_]*$' } });
  makePrivate(states);
  states.indexes = [
    'CREATE UNIQUE INDEX idx_account_retention_state_user ON account_retention_state (user)',
    'CREATE INDEX idx_account_retention_state_reminder_due ON account_retention_state (reminder_due_at, next_attempt_at)',
    'CREATE INDEX idx_account_retention_state_cleanup_due ON account_retention_state (cleanup_eligible_at)',
  ];
  dao.saveCollection(states);

  addField(comments, { name: 'author_user', type: 'relation', required: false, options: { collectionId: users.id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: ['name'] } });
  const commentIndexes = comments.indexes || [];
  commentIndexes.push('CREATE INDEX idx_comments_author_user ON comments (author_user)');
  comments.indexes = commentIndexes;
  dao.saveCollection(comments);

  // Historical comments have no durable authenticated-owner evidence. Leave
  // author_user empty rather than trusting email-only matches.
  const existingUsers = dao.findRecordsByFilter('users', 'verified = false', 'created', 100000, 0, {});
  for (let i = 0; i < existingUsers.length; i++) {
    const user = existingUsers[i];
    const createdMs = Date.parse(String(user.get('created') || ''));
    if (!isFinite(createdMs)) throw new Error('ACCOUNT_RETENTION_INVALID_CREATED');
    const state = new Record(dao.findCollectionByNameOrId('account_retention_state'));
    state.set('user', user.id);
    state.set('reminder_due_at', iso(Math.max(createdMs + 45 * DAY_MS, deployedAtMs)));
    state.set('cleanup_eligible_at', iso(Math.max(createdMs + 60 * DAY_MS, deployedAtMs + 15 * DAY_MS)));
    state.set('reminder_sent_at', null);
    state.set('reminder_attempts', 0);
    state.set('next_attempt_at', null);
    state.set('last_error_class', '');
    dao.saveRecord(state);
  }
}, (db) => {
  const dao = new Dao(db);
  try {
    const comments = dao.findCollectionByNameOrId('comments');
    const field = comments.schema.getFieldByName('author_user');
    if (field) comments.schema.removeField(field.id);
    comments.indexes = (comments.indexes || []).filter((sql) => sql.indexOf('idx_comments_author_user') === -1);
    dao.saveCollection(comments);
  } catch (_) {}
  try { dao.deleteCollection(dao.findCollectionByNameOrId('account_retention_state')); } catch (_) {}
});

