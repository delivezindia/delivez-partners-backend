import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { showOtpInResponse } from './otp-visibility';

describe('showOtpInResponse', () => {
  it('always shows the code in development', () => {
    assert.equal(showOtpInResponse({ NODE_ENV: 'development' }), true);
    assert.equal(showOtpInResponse({}), true);
  });

  it('hides it in production by default', () => {
    assert.equal(showOtpInResponse({ NODE_ENV: 'production' }), false);
    assert.equal(showOtpInResponse({ NODE_ENV: 'production', OTP_SHOW_IN_RESPONSE: 'false' }), false);
  });

  it('shows it in production only while OTP_SHOW_IN_RESPONSE=true and SMS is not live', () => {
    assert.equal(showOtpInResponse({ NODE_ENV: 'production', OTP_SHOW_IN_RESPONSE: 'true' }), true);
    assert.equal(showOtpInResponse({ NODE_ENV: 'production', OTP_SHOW_IN_RESPONSE: 'true', SMS_PROVIDER: 'DEV' }), true);
  });

  it('hides it automatically once MSG91 is the SMS provider', () => {
    assert.equal(showOtpInResponse({ NODE_ENV: 'production', OTP_SHOW_IN_RESPONSE: 'true', SMS_PROVIDER: 'MSG91' }), false);
    assert.equal(showOtpInResponse({ NODE_ENV: 'production', OTP_SHOW_IN_RESPONSE: 'true', SMS_PROVIDER: 'msg91' }), false);
  });
});
