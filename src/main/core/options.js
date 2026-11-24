'use strict';
// Úprava jednotlivých voleb v options.txt hry (ostatní řádky zůstanou beze změny).

const fs = require('fs');
const path = require('path');

/** values: { lang: 'cs_cz', fullscreen: 'true' } – zapíše jen to, co se liší. Vrací true, když se soubor změnil. */
function setOptions(gameDir, values) {
  const file = path.join(gameDir, 'options.txt');
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    /* první spuštění – hra si ostatní volby doplní sama */
  }
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}:${value}`;
    const i = lines.findIndex((l) => l.startsWith(key + ':'));
    if (i === -1) {
      lines.push(line);
      changed = true;
    } else if (lines[i] !== line) {
      lines[i] = line;
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n');
  }
  return changed;
}

const GAME_LANG = { cs: 'cs_cz', sk: 'sk_sk', en: 'en_us' };

module.exports = { setOptions, GAME_LANG };
