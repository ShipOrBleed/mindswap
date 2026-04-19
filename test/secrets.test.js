const assert = require('assert');
const { scanForSecrets, redactSecrets, scanAndRedact } = require('../src/secrets');

exports.test_detects_aws_key = () => {
  const findings = scanForSecrets('my key is AKIA1234567890ABCDEF here');
  assert.ok(findings.length > 0, 'should detect AWS key');
  assert.ok(findings[0].type.includes('AWS'));
};

exports.test_detects_github_token = () => {
  const findings = scanForSecrets('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234');
  assert.ok(findings.length > 0, 'should detect GitHub token');
};

exports.test_detects_sendgrid_key = () => {
  const findings = scanForSecrets('SENDGRID=SG.abcdefghijklmnopqrstuv.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrs');
  assert.ok(findings.length > 0, 'should detect SendGrid key');
};

exports.test_detects_database_url = () => {
  const findings = scanForSecrets('DATABASE_URL=postgres://user:pass@host:5432/db');
  assert.ok(findings.length > 0, 'should detect database URL');
};

exports.test_detects_private_key = () => {
  const findings = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
  assert.ok(findings.length > 0, 'should detect private key');
};

exports.test_skips_placeholders = () => {
  const findings = scanForSecrets('API_KEY=YOUR_KEY_HERE_REPLACE_ME');
  assert.strictEqual(findings.length, 0, 'should skip placeholders');
};

exports.test_skips_short_values = () => {
  const findings = scanForSecrets('key=abc');
  assert.strictEqual(findings.length, 0, 'should skip short values');
};

exports.test_redact_hides_middle = () => {
  const result = redactSecrets('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234 end');
  assert.ok(!result.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234'), 'should not contain full key');
  assert.ok(result.includes('...'), 'should contain redaction marker');
};

exports.test_scanAndRedact_returns_clean_for_safe_content = () => {
  const result = scanAndRedact('just normal code here', 'test.md');
  assert.strictEqual(result.clean, true);
  assert.strictEqual(result.findings.length, 0);
};

exports.test_scanAndRedact_redacts_secrets = () => {
  const result = scanAndRedact('key is AKIA1234567890ABCDEF here', 'test.md');
  assert.strictEqual(result.clean, false);
  assert.ok(result.findings.length > 0);
  assert.ok(!result.content.includes('AKIA1234567890ABCDEF'));
};
