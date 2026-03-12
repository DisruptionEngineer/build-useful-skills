// lib/template.js
'use strict';

const TEMPLATE_RE = /\{\{(env|creds|state)\.([^}]+)\}\}/g;

/**
 * Resolve {{env.X}}, {{creds.X}}, {{state.X}} templates.
 * Works on strings, objects (deep), and arrays.
 * Missing vars resolve to empty string.
 *
 * @param {string|object|array} input - Template string or object with template values
 * @param {{ env: object, creds: object, state: object }} ctx - Context with env, creds, state
 * @returns {string|object|array} Resolved value
 */
function resolveTemplate(input, ctx) {
  if (typeof input === 'string') {
    return input.replace(TEMPLATE_RE, (_, scope, key) => {
      const val = ctx[scope]?.[key];
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
  if (Array.isArray(input)) {
    return input.map(item => resolveTemplate(item, ctx));
  }
  if (input !== null && typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = resolveTemplate(v, ctx);
    }
    return out;
  }
  return input;
}

module.exports = { resolveTemplate };
