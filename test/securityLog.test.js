const { sanitizeLogData } = require('../src/utils/security');

describe('sanitizeLogData', () => {
  it('redacts nested authorization header', () => {
    const input = { req: { headers: { authorization: 'Bearer abc123' } } };
    expect(sanitizeLogData(input).req.headers.authorization).toBe('[REDACTED]');
  });
  
  it('redacts Authorization with capital A', () => {
    const input = { Authorization: 'Bearer xyz' };
    expect(sanitizeLogData(input).Authorization).toBe('[REDACTED]');
  });
  
  it('redacts passwords inside arrays', () => {
    const input = [{ password: 'secret' }];
    expect(sanitizeLogData(input)[0].password).toBe('[REDACTED]');
  });
  
  it('does not affect non-sensitive fields', () => {
    const input = { userId: '123', email: 'test@test.com' };
    expect(sanitizeLogData(input).userId).toBe('123');
  });
});
