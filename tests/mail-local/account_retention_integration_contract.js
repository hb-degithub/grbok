'use strict';

var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');
var contract = Object.freeze({
  producer: 'Track C account retention',
  consumer: 'Track B register facade',
  module: 'pb_hooks/lib/account_retention.js',
  exportName: 'initializeNewUser',
  parameters: Object.freeze(['txDao', 'userRecord', 'nowMs']),
  call: 'accountRetention.initializeNewUser(txDao, userRecord, nowMs)',
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function verify() {
  var modulePath = path.join(repoRoot, contract.module);
  var hookPath = path.join(repoRoot, 'pb_hooks', 'account_retention.pb.js');
  var source = fs.readFileSync(modulePath, 'utf8');
  var hookSource = fs.readFileSync(hookPath, 'utf8');
  var accountRetention = require(modulePath);

  assert(typeof accountRetention[contract.exportName] === 'function', 'initializeNewUser must remain exported');
  assert(accountRetention[contract.exportName].length === contract.parameters.length, 'initializeNewUser arity changed');
  assert(source.indexOf('function initializeNewUser(txDao, userRecord, nowMs)') !== -1, 'initializeNewUser parameter contract changed');
  assert(source.indexOf('initializeNewUser: initializeNewUser') !== -1, 'initializeNewUser module export changed');
  assert(hookSource.indexOf('onRecordBeforeCreateRequest') === -1 && hookSource.indexOf('onRecordAfterCreateRequest') === -1,
    'Track C must not register a users create hook; Track B register facade owns initialization');
  return contract;
}

if (require.main === module) {
  verify();
  process.stdout.write('PASS account retention Track B integration contract\n');
}

module.exports = Object.freeze({ contract: contract, verify: verify });
