'use strict';
// Cesty ke složkám launcheru. Vše je v jedné složce, kterou lze změnit v nastavení.

const path = require('path');
const os = require('os');

function defaultRoot() {
  const home = os.homedir();
  // Verze z Microsoft Storu (MSIX) má AppData přesměrované do balíčku, proto složka v profilu uživatele.
  if (process.windowsStore) return path.join(home, '.wylvarion');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.wylvarion');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'wylvarion');
  return path.join(home, '.wylvarion');
}

function layout(root) {
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    game: path.join(root, 'game'),
    mods: path.join(root, 'game', 'mods'),
    shaderpacks: path.join(root, 'game', 'shaderpacks'),
    resourcepacks: path.join(root, 'game', 'resourcepacks'),
    config: path.join(root, 'game', 'config'),
    natives: (id) => path.join(root, 'versions', id, 'natives'),
    logs: path.join(root, 'logs')
  };
}

/** Převede Maven souřadnice "group:artifact:version[:classifier][@ext]" na relativní cestu. */
function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at !== -1) {
    ext = n.slice(at + 1);
    n = n.slice(0, at);
  }
  const [group, artifact, version, classifier] = n.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

module.exports = { defaultRoot, layout, mavenPath };
