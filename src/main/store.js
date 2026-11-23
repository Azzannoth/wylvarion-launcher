'use strict';
// Uložení nastavení a účtu. Tokeny účtu jsou šifrované systémovým úložištěm (safeStorage).

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  root: null,
  memoryMb: null,
  shaderPreset: 'auto',
  optionalMods: {},
  afterLaunch: 'hide',
  autoJoin: false,
  width: null,
  height: null,
  firstRunDone: false
};

function file(name) {
  return path.join(app.getPath('userData'), name);
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file('settings.json'), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file('settings.json'), JSON.stringify(s, null, 2));
}

function loadAccount() {
  try {
    const raw = fs.readFileSync(file('account.bin'));
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function saveAccount(acc) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const json = JSON.stringify(acc);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.writeFileSync(file('account.bin'), data, { mode: 0o600 });
}

function clearAccount() {
  fs.rmSync(file('account.bin'), { force: true });
}

module.exports = { loadSettings, saveSettings, loadAccount, saveAccount, clearAccount };
