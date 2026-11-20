'use strict';
// Vyhodnocení pravidel z Mojang version JSON (knihovny a argumenty).

const os = require('os');

function currentOs() {
  const p = process.platform;
  const name = p === 'win32' ? 'windows' : p === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'ia32' ? 'x86' : process.arch;
  return { name, arch, version: os.release() };
}

function ruleMatches(rule, env, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== env.name) return false;
    if (rule.os.arch && rule.os.arch !== env.arch) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(env.version)) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (Boolean(features[k]) !== v) return false;
    }
  }
  return true;
}

/** Vrátí true, pokud prvek s danými pravidly platí pro tento systém. */
function allowed(rules, env = currentOs(), features = {}) {
  if (!rules || rules.length === 0) return true;
  let result = false;
  for (const rule of rules) {
    if (ruleMatches(rule, env, features)) result = rule.action === 'allow';
  }
  return result;
}

/** Rozbalí seznam argumentů (řetězce i objekty s pravidly) na pole řetězců. */
function expandArgs(list, env, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(a);
    else if (allowed(a.rules, env, features)) out.push(...(Array.isArray(a.value) ? a.value : [a.value]));
  }
  return out;
}

function substitute(arg, vars) {
  return arg.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

module.exports = { currentOs, allowed, expandArgs, substitute };
