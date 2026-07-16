routerAdd('GET', '/api/test/security-rate/outbox', function (c) {
  try {
    var outbox = require(__hooks + '/lib/mail_outbox.js');
    var collection = $app.dao().findCollectionByNameOrId('mail_outbox');
    if (collection.listRule !== null || collection.viewRule !== null || collection.createRule !== null || collection.updateRule !== null || collection.deleteRule !== null) {
      throw new Error('mail_outbox API rules must be private');
    }
    if (!collection.schema.getFieldByName('lease_token')) throw new Error('mail_outbox lease_token missing');
    var probeNow = Date.now();
    for (var probe = 0; probe < 5; probe++) {
      $app.dao().runInTransaction(function (txDao) {
        var queuedProbe = outbox.enqueue(txDao, { dedupeKey: 'lease-probe:' + probe, category: 'comment_notification', recipient: 'probe@example.com', templateKey: 'comment_new', variables: { postTitle: 'Probe', commenter: 'Worker', content: 'Lease', postUrl: 'http://localhost:4321/posts/probe' } });
        if (!queuedProbe.queued) throw new Error('lease probe enqueue failed');
      });
    }
    var probeLeases = outbox._leaseBatch(probeNow, 99);
    if (probeLeases.length !== 5 || !probeLeases[0].leaseToken) throw new Error('lease batch must be capped at five with tokens');
    if (outbox._leaseBatch(probeNow + 179000, 99).length !== 0) throw new Error('second worker reclaimed within worst-case lease');
    if (!outbox._renewLease(probeLeases[0].id, probeLeases[0].leaseToken, probeNow + 170000)) throw new Error('active worker failed to renew lease');
    var expiredReclaims = outbox._leaseBatch(probeNow + 181000, 99);
    if (expiredReclaims.length !== 4) throw new Error('expired leases were not recoverable after 180 seconds');
    var firstReclaimed = outbox._leaseBatch(probeNow + 351000, 99);
    if (firstReclaimed.length !== 1 || outbox._renewLease(probeLeases[0].id, probeLeases[0].leaseToken, probeNow + 352000)) throw new Error('stale worker retained ownership after reclaim');
    var probeRows = $app.dao().findRecordsByFilter('mail_outbox', 'dedupe_key ~ "lease-probe:"', '', 20, 0);
    for (var pr = 0; pr < probeRows.length; pr++) $app.dao().deleteRecord(probeRows[pr]);
    var probeBuckets = $app.dao().findRecordsByFilter('security_rate_buckets', 'id != ""', '', 500, 0);
    for (var pb = 0; pb < probeBuckets.length; pb++) $app.dao().deleteRecord(probeBuckets[pb]);
    var first;
    var duplicate;
    $app.dao().runInTransaction(function (txDao) {
      first = outbox.enqueue(txDao, {
        dedupeKey: 'comment:test:author', category: 'comment_notification', recipient: 'author@example.com',
        templateKey: 'comment_new', variables: { postTitle: 'Hello', commenter: 'Reader', content: 'Nice', postUrl: 'http://localhost:4321/posts/hello' },
      });
      duplicate = outbox.enqueue(txDao, {
        dedupeKey: 'comment:test:author', category: 'comment_notification', recipient: 'author@example.com',
        templateKey: 'comment_new', variables: { postTitle: 'Hello', commenter: 'Reader', content: 'Nice', postUrl: 'http://localhost:4321/posts/hello' },
      });
    });
    if (!first.queued || duplicate.queued || first.outboxId !== duplicate.outboxId) throw new Error('outbox dedupe mismatch');
    outbox._render($app.dao().findRecordById('mail_outbox', first.outboxId));

    var oldNow = Date.now() - 240000;
    var leased = outbox._leaseBatch(oldNow, 10);
    var leasedAgain = outbox._leaseBatch(oldNow, 10);
    if (leased.length !== 1 || leasedAgain.length !== 0) {
      var leaseRow = $app.dao().findRecordById('mail_outbox', first.outboxId);
      throw new Error('atomic lease mismatch ' + leased.length + '/' + leasedAgain.length + ' status=' + leaseRow.getString('status') + ' lease=' + leaseRow.getString('lease_until'));
    }
    var sent = outbox.processBatch(Date.now(), 10);
    if (sent.sent !== 1) {
      var sentRow = $app.dao().findRecordById('mail_outbox', first.outboxId);
      throw new Error('stale lease was not recovered and sent: ' + JSON.stringify(sent) + ' error=' + sentRow.getString('last_error_class'));
    }
    var row = $app.dao().findRecordById('mail_outbox', first.outboxId);
    if (row.getString('status') !== 'sent') throw new Error('outbox row not marked sent');
    var logs = $app.dao().findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 20, 0);
    if (logs.length !== 1 || logs[0].getString('source_kind') !== 'comment' || logs[0].getString('result') !== 'sent') throw new Error('minimal sent log mismatch');

    var failed;
    $app.dao().runInTransaction(function (txDao) {
      failed = outbox.enqueue(txDao, {
        dedupeKey: 'comment:fail:author', category: 'comment_notification', recipient: 'permanent@example.com',
        templateKey: 'comment_new', variables: { postTitle: 'Fail', commenter: 'Reader', content: 'Nope', postUrl: 'http://localhost:4321/posts/fail' },
      });
    });
    var failureResult = outbox.processBatch(Date.now(), 10);
    if (failureResult.failed !== 1) throw new Error('permanent gateway failure not classified');
    var failedRow = $app.dao().findRecordById('mail_outbox', failed.outboxId);
    if (failedRow.getString('status') !== 'failed') throw new Error('permanent outbox row not failed');

    var retention;
    $app.dao().runInTransaction(function (txDao) {
      retention = outbox.enqueue(txDao, {
        dedupeKey: 'retention:user:test', category: 'account_retention_notice', recipient: 'reader@example.com',
        templateKey: 'account_retention_notice', variables: { displayName: 'Reader', cleanupDate: '2026-09-14' },
      });
    });
    var retentionResult = outbox.processBatch(Date.now(), 10);
    if (retentionResult.sent !== 1 || $app.dao().findRecordById('mail_outbox', retention.outboxId).getString('status') !== 'sent') throw new Error('retention outbox contract failed');
    var rateForReset = require(__hooks + '/lib/security_rate_limit.js');
    var outboundRows = $app.dao().findRecordsByFilter('security_rate_buckets', 'policy = "outbound_global" && subject_hash = {:hash}', '', 10, 0, { hash: rateForReset._subjectHash('outbound_global', 'v1') });
    for (var orow = 0; orow < outboundRows.length; orow++) $app.dao().deleteRecord(outboundRows[orow]);

    for (var q = 0; q < 58; q++) {
      $app.dao().runInTransaction(function (txDao) {
        var queued = outbox.enqueue(txDao, {
          dedupeKey: 'comment:quota:' + q, category: 'comment_notification', recipient: 'quota@example.com',
          templateKey: 'comment_new', variables: { postTitle: 'Quota', commenter: 'Reader', content: 'Body', postUrl: 'http://localhost:4321/posts/quota' },
        });
        if (!queued.queued) throw new Error('quota setup denied early at ' + q);
      });
    }
    var beforeDeniedRows = $app.dao().findRecordsByFilter('mail_outbox', 'id != ""', 'created', 500, 0).length;
    var denied;
    $app.dao().runInTransaction(function (txDao) {
      denied = outbox.enqueue(txDao, {
        dedupeKey: 'comment:quota:denied', category: 'comment_notification', recipient: 'quota@example.com',
        templateKey: 'comment_new', variables: { postTitle: 'Quota', commenter: 'Reader', content: 'Denied', postUrl: 'http://localhost:4321/posts/quota' },
      });
    });
    var afterDeniedRows = $app.dao().findRecordsByFilter('mail_outbox', 'id != ""', 'created', 500, 0).length;
    var afterDeniedLogs = $app.dao().findRecordsByFilter('mail_delivery_logs', 'id != ""', 'created', 500, 0).length;
    if (!denied.limited || denied.outboxId !== null || beforeDeniedRows !== afterDeniedRows || afterDeniedLogs !== 3) throw new Error('quota denial wrote outbox/log state');

    return c.json(200, { ok: true, dedupe: true, lease: true, leaseToken: true, sent: sent.sent, failed: failureResult.failed, retention: true, quotaDenied: true });
  } catch (error) {
    return c.json(500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
});

routerAdd('POST', '/internal/mail/send', function (c) {
  var body = JSON.parse(readerToString(c.request().body, 262144) || '{}');
  if (String(body.to || '') === 'permanent@example.com') {
    return c.json(422, { ok: false, error: { code: 'RECIPIENT_PERMANENT', retryable: false } });
  }
  return c.json(202, { ok: true, requestId: String(body.requestId || '') });
});
