const { sanitizeLogData } = require('../src/utils/security');
const assert = require('assert');

test('sanitizeLogData redacts nested authorization header', () => {
  const input = { req: { headers: { authorization: 'Bearer abc123' } } };
  const result = sanitizeLogData(input);
  assert.equal(result.req.headers.authorization, '[REDACTED]');
});

test('sanitizeLogData redacts Authorization with capital A', () => {
  const input = { Authorization: 'Bearer xyz' };
  const result = sanitizeLogData(input);
  assert.equal(result.Authorization, '[REDACTED]');
});

test('sanitizeLogData redacts passwords inside arrays', () => {
  const input = [{ password: 'secret' }];
  const result = sanitizeLogData(input);
  assert.equal(result[0].password, '[REDACTED]');
});

test('sanitizeLogData does not affect non-sensitive fields', () => {
  const input = { userId: '123', email: 'test@test.com' };
  const result = sanitizeLogData(input);
  assert.equal(result.userId, '123');
  assert.equal(result.email, 'test@test.com');
});
