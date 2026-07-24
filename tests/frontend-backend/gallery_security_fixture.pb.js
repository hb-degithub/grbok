routerAdd('POST', '/api/test/gallery/setup', function (c) {
  var ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';

  function findCollection(name) {
    try { return $app.dao().findCollectionByNameOrId(name); } catch (_) { return null; }
  }

  function ensureField(collection, field) {
    try {
      var existing = collection.schema.getFieldByName(field.name);
      if (existing && existing.id) field.id = existing.id;
    } catch (_) {}
    collection.schema.addField(new SchemaField(field));
  }

  function ensureGuestbookCollection() {
    var collection = findCollection('guestbook_messages');
    if (!collection) collection = new Collection({ name: 'guestbook_messages', type: 'base', system: false, schema: [] });
    ensureField(collection, { name: 'nickname', type: 'text', required: true, options: { min: 1, max: 30, pattern: '' } });
    ensureField(collection, { name: 'content', type: 'text', required: true, options: { min: 1, max: 500, pattern: '' } });
    ensureField(collection, { name: 'status', type: 'select', required: true, options: { maxSelect: 1, values: ['show', 'hidden'] } });
    collection.listRule = 'status = "show"';
    collection.viewRule = 'status = "show"';
    collection.createRule = '';
    collection.updateRule = '@request.auth.role = "super_admin"';
    collection.deleteRule = '@request.auth.role = "super_admin"';
    $app.dao().saveCollection(collection);
    return $app.dao().findCollectionByNameOrId('guestbook_messages');
  }

  function createUser(prefix, suffix, role, verified) {
    var user = new Record($app.dao().findCollectionByNameOrId('users'));
    user.set('email', prefix + '_' + suffix + '@example.local');
    user.set('username', prefix + '_' + suffix);
    user.set('password', 'Gallery-Test-12345!');
    user.set('passwordConfirm', 'Gallery-Test-12345!');
    user.set('role', role);
    user.set('verified', verified);
    user.refreshTokenKey();
    $app.dao().saveRecord(user);
    return user;
  }

  function hash(secret, namespace, value) {
    return $security.hs256(namespace + ':' + String(value), secret);
  }

  function createStepUp(user, prefix, hashSecret) {
    var selector = $security.randomStringWithAlphabet(24, ALPHABET);
    var rawSecret = $security.randomStringWithAlphabet(43, ALPHABET);
    var binding = {
      clientSession: $security.randomStringWithAlphabet(43, ALPHABET),
      fingerprint: 'gallery-fingerprint-' + prefix,
      userAgent: 'gallery-agent-' + prefix,
      ip: '127.0.0.1',
    };
    var record = new Record($app.dao().findCollectionByNameOrId('admin_step_up_sessions'));
    record.set('user', user.id);
    record.set('selector', selector);
    record.set('secret_hmac', hash(hashSecret, 'step-up-secret', rawSecret));
    record.set('client_session_hmac', hash(hashSecret, 'step-up-client-session', binding.clientSession));
    record.set('fingerprint_hash', hash(hashSecret, 'step-up-fingerprint', binding.fingerprint));
    record.set('ip_hash', hash(hashSecret, 'step-up-ip', binding.ip));
    record.set('user_agent_hash', hash(hashSecret, 'step-up-ua', binding.userAgent));
    record.set('verified_at', new Date().toISOString());
    record.set('expires_at', new Date(Date.now() + 30 * 60 * 1000).toISOString());
    record.set('revoked_at', '');
    $app.dao().saveRecord(record);
    return {
      token: $tokens.recordAuthToken($app, user),
      credential: 'v1.' + selector + '.' + rawSecret,
      clientSession: binding.clientSession,
      fingerprint: binding.fingerprint,
      userAgent: binding.userAgent,
      userId: user.id,
    };
  }

  try {
    var gallery = $app.dao().findCollectionByNameOrId('gallery_items');
    var guestbook = ensureGuestbookCollection();
    var suffix = $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
    var hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    if (hashSecret.length < 32) throw new Error('fixture hash secret missing');

    var author = createUser('gallery_author', suffix, 'author', true);
    var unverified = createUser('gallery_unverified', suffix, 'author', false);
    var superAdmin = createUser('gallery_super', suffix, 'super_admin', true);
    var guestbookRecord = new Record(guestbook);
    guestbookRecord.set('nickname', 'guest-nick-' + suffix);
    guestbookRecord.set('content', 'guestbook-content-canary-' + suffix);
    guestbookRecord.set('status', 'show');
    $app.dao().saveRecord(guestbookRecord);

    return c.json(200, {
      ok: true,
      galleryCollectionId: gallery.id,
      guestbookId: guestbookRecord.id,
      guestbookNickname: guestbookRecord.getString('nickname'),
      guestbookContent: guestbookRecord.getString('content'),
      author: createStepUp(author, 'author-' + suffix, hashSecret),
      unverified: createStepUp(unverified, 'unverified-' + suffix, hashSecret),
      superAdmin: createStepUp(superAdmin, 'super-' + suffix, hashSecret),
    });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('POST', '/api/test/gallery/audits', function (c) {
  function auditRows(targetId) {
    var rows = $app.dao().findRecordsByFilter('audit_logs', 'target_id = {:target}', 'created,id', 50, 0, { target: String(targetId || '') });
    return rows.map(function (row) {
      return {
        actor: row.getString('actor'),
        action: row.getString('action'),
        targetCollection: row.getString('target_collection'),
        targetId: row.getString('target_id'),
        summary: row.getString('summary'),
        ip: row.getString('ip'),
        userAgent: row.getString('user_agent'),
      };
    });
  }

  try {
    var input = JSON.parse(readerToString(c.request().body, 16384) || '{}');
    return c.json(200, {
      ok: true,
      gallery: auditRows(input.galleryId),
      guestbook: auditRows(input.guestbookId),
      pbAdmin: auditRows(input.pbAdminGalleryId),
    });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});
routerAdd('POST', '/api/test/gallery/binding-probe', function (c) {
  try {
    var info = $apis.requestInfo(c);
    var actor = (info && (info.auth || info.authRecord)) || null;
    var credential = String(c.request().header.get('X-Admin-Step-Up') || '').trim();
    var match = /^v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(credential);
    var row = match ? $app.dao().findFirstRecordByFilter('admin_step_up_sessions', 'selector = {:selector}', { selector: match[1] }) : null;
    var hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    var session = String(c.request().header.get('X-Admin-Session') || '').trim();
    var fingerprint = String(c.request().header.get('X-Browser-Fingerprint') || '').trim();
    var userAgent = String(c.request().header.get('User-Agent') || '').trim();
    var ip = String(c.realIP() || '').trim();
    function equal(left, right) { return typeof left === 'string' && typeof right === 'string' && $security.equal(left, right); }
    function hash(namespace, value) { return $security.hs256(namespace + ':' + String(value), hashSecret); }
    return c.json(200, {
      actor: !!actor,
      role: actor ? String(actor.get('role') || '') : '',
      verified: !!(actor && actor.verified()),
      shape: !!match,
      row: !!row,
      matchesUser: !!(row && actor && row.getString('user') === actor.id),
      matchesSecret: !!(row && match && equal(row.getString('secret_hmac'), hash('step-up-secret', match[2]))),
      matchesSession: !!(row && equal(row.getString('client_session_hmac'), hash('step-up-client-session', session))),
      matchesFingerprint: !!(row && equal(row.getString('fingerprint_hash'), hash('step-up-fingerprint', fingerprint))),
      matchesIp: !!(row && equal(row.getString('ip_hash'), hash('step-up-ip', ip))),
      matchesUserAgent: !!(row && equal(row.getString('user_agent_hash'), hash('step-up-ua', userAgent))),
      hasIp: !!ip,
      hasUserAgent: !!userAgent,
    });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});
onRecordBeforeCreateRequest(function (e) {
  try {
    var c = e.httpContext;
    var info = $apis.requestInfo(c);
    var actor = (info && (info.auth || info.authRecord)) || null;
    var credential = String(c.request().header.get('X-Admin-Step-Up') || '').trim();
    var match = /^v1\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/.exec(credential);
    var row = match ? $app.dao().findFirstRecordByFilter('admin_step_up_sessions', 'selector = {:selector}', { selector: match[1] }) : null;
    var hashSecret = String($os.getenv('ADMIN_AUTH_HASH_SECRET') || '');
    var session = String(c.request().header.get('X-Admin-Session') || '').trim();
    var fingerprint = String(c.request().header.get('X-Browser-Fingerprint') || '').trim();
    var userAgent = String(c.request().header.get('User-Agent') || '').trim();
    var ip = String(c.realIP() || '').trim();
    function equal(left, right) { return typeof left === 'string' && typeof right === 'string' && $security.equal(left, right); }
    function hash(namespace, value) { return $security.hs256(namespace + ':' + String(value), hashSecret); }
    globalThis.galleryMultipartBindingProbe = {
      actor: !!actor,
      shape: !!match,
      row: !!row,
      matchesUser: !!(row && actor && row.getString('user') === actor.id),
      matchesSecret: !!(row && match && equal(row.getString('secret_hmac'), hash('step-up-secret', match[2]))),
      matchesSession: !!(row && equal(row.getString('client_session_hmac'), hash('step-up-client-session', session))),
      matchesFingerprint: !!(row && equal(row.getString('fingerprint_hash'), hash('step-up-fingerprint', fingerprint))),
      matchesIp: !!(row && equal(row.getString('ip_hash'), hash('step-up-ip', ip))),
      matchesUserAgent: !!(row && equal(row.getString('user_agent_hash'), hash('step-up-ua', userAgent))),
      userAgentLength: userAgent.length,
      ipLength: ip.length,
    };
  } catch (error) {
    globalThis.galleryMultipartBindingProbe = { diagnosticError: String(error && error.message ? error.message : error) };
  }
}, 'gallery_items');

routerAdd('GET', '/api/test/gallery/multipart-binding-probe', function (c) {
  return c.json(200, globalThis.galleryMultipartBindingProbe || { missing: true });
});