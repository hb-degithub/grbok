'use strict';

var policyStore = require('./security_policy_store.js');
var mailCrypto = require('./mail_crypto.js');

var MAX_EVENTS = 300;
var MAX_EVENTS_BYTES = 16384;
var MAX_FUTURE_SKEW_MS = 5000;

function RateLimitUnavailableError(message) {
  this.name = 'RateLimitUnavailableError';
  this.message = message || 'rate limit storage unavailable';
}
RateLimitUnavailableError.prototype = Object.create(Error.prototype);
RateLimitUnavailableError.prototype.constructor = RateLimitUnavailableError;

function unavailable(message) {
  return new RateLimitUnavailableError(message);
}

function invalid(message) {
  var error = new Error(message || 'invalid rate limit input');
  error.name = 'InvalidRateLimitInputError';
  return error;
}

function parseEvents(raw, nowMs) {
  if (typeof raw !== 'string' || raw.length > MAX_EVENTS_BYTES) throw unavailable('invalid events payload');
  var values;
  try {
    values = JSON.parse(raw || '[]');
  } catch (_) {
    throw unavailable('invalid events payload');
  }
  if (!Array.isArray(values) || values.length > MAX_EVENTS) throw unavailable('invalid events payload');
  var previous = -1;
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (!Number.isSafeInteger(value) || value < previous || value > nowMs + MAX_FUTURE_SKEW_MS) {
      throw unavailable('invalid events payload');
    }
    previous = value;
  }
  return values;
}

function pruneEvents(values, nowMs, windowSeconds) {
  var cutoff = nowMs - (windowSeconds * 1000);
  var first = 0;
  while (first < values.length && values[first] <= cutoff) first++;
  return values.slice(first);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') throw invalid('email must be a string');
  var normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320 || /\s/.test(normalized)) throw invalid('invalid email');
  var at = normalized.indexOf('@');
  if (at < 1 || at !== normalized.lastIndexOf('@') || at === normalized.length - 1) throw invalid('invalid email');
  return normalized;
}

function parseIpv4(value) {
  var parts = value.split('.');
  if (parts.length !== 4) return null;
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    var part = Number(parts[i]);
    if (part < 0 || part > 255) return null;
    result.push(String(part));
  }
  return result.join('.');
}

function ipv4Hextets(value) {
  var normalized = parseIpv4(value);
  if (!normalized) return null;
  var p = normalized.split('.').map(Number);
  return [((p[0] << 8) | p[1]).toString(16), ((p[2] << 8) | p[3]).toString(16)];
}

function expandIpv6(value) {
  var source = String(value || '').toLowerCase();
  if (!source || source.indexOf('%') !== -1 || source.indexOf(':::') !== -1) throw invalid('invalid IPv6');
  if (source.charAt(0) === '[' && source.charAt(source.length - 1) === ']') source = source.slice(1, -1);
  var split = source.split('::');
  if (split.length > 2) throw invalid('invalid IPv6');

  function parseSide(side) {
    if (!side) return [];
    var tokens = side.split(':');
    var output = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].indexOf('.') !== -1) {
        if (i !== tokens.length - 1) throw invalid('invalid IPv6');
        var pair = ipv4Hextets(tokens[i]);
        if (!pair) throw invalid('invalid IPv6');
        output.push(pair[0], pair[1]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tokens[i])) throw invalid('invalid IPv6');
        output.push(Number.parseInt(tokens[i], 16).toString(16));
      }
    }
    return output;
  }

  var left = parseSide(split[0]);
  var right = parseSide(split.length === 2 ? split[1] : '');
  if (split.length === 1) {
    if (left.length !== 8) throw invalid('invalid IPv6');
    return left;
  }
  var missing = 8 - left.length - right.length;
  if (missing < 1) throw invalid('invalid IPv6');
  var zeros = [];
  for (var z = 0; z < missing; z++) zeros.push('0');
  return left.concat(zeros, right);
}

function compressIpv6(parts) {
  var bestStart = -1;
  var bestLength = 0;
  var currentStart = -1;
  for (var i = 0; i <= parts.length; i++) {
    if (i < parts.length && parts[i] === '0') {
      if (currentStart === -1) currentStart = i;
    } else if (currentStart !== -1) {
      var length = i - currentStart;
      if (length > bestLength && length >= 2) {
        bestStart = currentStart;
        bestLength = length;
      }
      currentStart = -1;
    }
  }
  if (bestStart === -1) return parts.join(':');
  var left = parts.slice(0, bestStart).join(':');
  var right = parts.slice(bestStart + bestLength).join(':');
  if (!left && !right) return '::';
  if (!left) return '::' + right;
  if (!right) return left + '::';
  return left + '::' + right;
}

function normalizeIp(value) {
  if (typeof value !== 'string') throw invalid('IP must be a string');
  var source = value.trim();
  if (!source) throw invalid('IP is required');
  var ipv4 = parseIpv4(source);
  if (ipv4) return ipv4;
  return compressIpv6(expandIpv6(source));
}

function ipv6Prefix64(value) {
  var normalized = normalizeIp(value);
  if (normalized.indexOf(':') === -1) throw invalid('IPv6 is required');
  var parts = expandIpv6(normalized);
  return compressIpv6(parts.slice(0, 4).concat(['0', '0', '0', '0'])) + '/64';
}

function subjectHash(policyKey, subject) {
  return mailCrypto.hashPrivate('rate:' + String(policyKey), String(subject));
}

function findBucket(dao, policyKey, hash) {
  var records;
  try {
    records = dao.findRecordsByFilter(
      'security_rate_buckets',
      'policy = {:policy} && subject_hash = {:hash}',
      '', 2, 0,
      { policy: policyKey, hash: hash },
    );
  } catch (_) {
    throw unavailable();
  }
  if (records.length > 1) throw unavailable();
  return records.length ? records[0] : null;
}

function prepareEntry(txDao, entry, nowMs, policies) {
  if (!entry || typeof entry !== 'object') throw invalid();
  var key = String(entry.policyKey || '');
  var policy = policies[key];
  if (!policy || typeof entry.subject !== 'string' || !entry.subject) throw invalid();
  var hash = subjectHash(key, entry.subject);
  var record = findBucket(txDao, key, hash);
  var events = record ? pruneEvents(parseEvents(String(record.get('events_json')), nowMs), nowMs, policy.windowSeconds) : [];
  return { policy: { key: key, limit: policy.limit, windowSeconds: policy.windowSeconds }, hash: hash, record: record, events: events };
}

function retryAfter(item, nowMs) {
  if (!item.events.length) return 1;
  var remaining = item.events[0] + (item.policy.windowSeconds * 1000) - nowMs;
  return Math.max(1, Math.ceil(remaining / 1000));
}

function writeBucket(txDao, item, nowMs) {
  var events = item.events.concat([nowMs]);
  var raw = JSON.stringify(events);
  if (events.length > MAX_EVENTS || raw.length > MAX_EVENTS_BYTES) throw unavailable();
  var record = item.record;
  if (!record) {
    try {
      record = new Record(txDao.findCollectionByNameOrId('security_rate_buckets'));
      record.set('policy', item.policy.key);
      record.set('subject_hash', item.hash);
      record.set('events_json', raw);
      record.set('expires_at', new Date(nowMs + item.policy.windowSeconds * 1000).toISOString());
      txDao.saveRecord(record);
      return;
    } catch (error) {
      record = findBucket(txDao, item.policy.key, item.hash);
      if (!record) throw unavailable();
      var fresh = pruneEvents(parseEvents(String(record.get('events_json')), nowMs), nowMs, item.policy.windowSeconds);
      if (fresh.length >= item.policy.limit) throw unavailable();
      raw = JSON.stringify(fresh.concat([nowMs]));
    }
  }
  try {
    record.set('events_json', raw);
    record.set('expires_at', new Date(nowMs + item.policy.windowSeconds * 1000).toISOString());
    txDao.saveRecord(record);
  } catch (_) {
    throw unavailable();
  }
}

function consume(txDao, input) {
  if (!txDao || !input || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0 ||
      !Array.isArray(input.entries) || !input.entries.length || input.entries.length > 8) {
    throw invalid();
  }
  var policySet = policyStore.getRatePolicySet(txDao);
  if (policySet.degraded) throw unavailable();
  var seen = {};
  var prepared = [];
  for (var i = 0; i < input.entries.length; i++) {
    var key = String(input.entries[i] && input.entries[i].policyKey || '');
    if (seen[key]) throw invalid('duplicate policy entry');
    seen[key] = true;
    prepared.push(prepareEntry(txDao, input.entries[i], input.nowMs, policySet.policies));
  }
  for (var p = 0; p < prepared.length; p++) {
    if (prepared[p].events.length >= prepared[p].policy.limit) {
      return {
        allowed: false,
        limitedBy: prepared[p].policy.key,
        retryAfterSeconds: retryAfter(prepared[p], input.nowMs),
      };
    }
  }
  for (var s = 0; s < prepared.length; s++) writeBucket(txDao, prepared[s], input.nowMs);
  return { allowed: true, limitedBy: null, retryAfterSeconds: 0 };
}

module.exports = {
  RateLimitUnavailableError: RateLimitUnavailableError,
  consume: consume,
  normalizeEmail: normalizeEmail,
  normalizeIp: normalizeIp,
  ipv6Prefix64: ipv6Prefix64,
  _parseEvents: parseEvents,
  _pruneEvents: pruneEvents,
  _subjectHash: subjectHash,
};
