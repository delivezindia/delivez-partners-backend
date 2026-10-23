import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { docsMode } from './docs-auth';

describe('docsMode', () => {
  it('is open in development', () => {
    assert.equal(docsMode({}), 'open');
    assert.equal(docsMode({ NODE_ENV: 'development' }), 'open');
  });
  it('is off in production without a username and password', () => {
    assert.equal(docsMode({ NODE_ENV: 'production' }), 'off');
    assert.equal(docsMode({ NODE_ENV: 'production', DOCS_USERNAME: 'team' }), 'off');
    assert.equal(docsMode({ NODE_ENV: 'production', DOCS_PASSWORD: 'secret' }), 'off');
  });
  it('needs a password in production when both are set', () => {
    assert.equal(docsMode({ NODE_ENV: 'production', DOCS_USERNAME: 'team', DOCS_PASSWORD: 'secret' }), 'password');
  });
});
