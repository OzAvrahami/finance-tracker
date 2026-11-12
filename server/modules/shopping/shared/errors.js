'use strict';

// Domain codes only: HTTP status/translation belongs to the later integration.
class ShoppingDomainError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShoppingDomainError';
    this.code = code;
  }
}

function requireRule(condition, code) {
  if (!condition) throw new ShoppingDomainError(code);
}

module.exports = { ShoppingDomainError, requireRule };
