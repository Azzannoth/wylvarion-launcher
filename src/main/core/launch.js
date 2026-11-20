'use strict';
// Sestavení příkazové řádky a spuštění hry.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { currentOs, expandArgs, substitute } = require('./rules');

/**
 * Sestaví argumenty JVM a hry.
 * @param {object} p
 *   install – výsledek minecraft.install()
 *   dirs, account {name, uuid, accessToken, xuid}, server {host, port}, memoryMb, launcherVersion
 */
function buildCommand(p) {
  const { install, dirs, account, server, memoryMb, launcherVersion, width, height } = p;
  const env = p.env || currentOs();
  const { vanilla, fabric, clientJar, libs, nativesDir, logging } = install;
  const sep = env.name === 'windows' ? ';' : ':';

  const classpath = [...libs.classpath.map((l) => l.path), clientJar].join(sep);
  const address = server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;

  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(width && height),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: Boolean(server && server.host),
    is_quick_play_realms: false
  };

  const vars = {
    auth_player_name: account.name,
    version_name: fabric ? fabric.id : vanilla.id,
    game_directory: dirs.game,
    assets_root: dirs.assets,
    assets_index_name: vanilla.assetIndex.id,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    clientid: account.clientId || '0',
    auth_xuid: account.xuid || '0',
    user_type: 'msa',
    version_type: 'Wylvarion',
    natives_directory: nativesDir,
    launcher_name: 'wylvarion-launcher',
    launcher_version: launcherVersion || '1.0.0',
    classpath,
    classpath_separator: sep,
    library_directory: dirs.libraries,
    resolution_width: width || 1280,
    resolution_height: height || 720,
    quickPlayMultiplayer: address,
    quickPlayPath: path.join(dirs.game, 'quickPlay', 'log.json')
  };

  const mem = Math.max(1024, Math.round(memoryMb || 4096));
  const jvm = [
    `-Xmx${mem}M`,
    `-Xms${Math.min(mem, 1024)}M`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-Dfile.encoding=UTF-8',
    ...expandArgs(vanilla.arguments.jvm, env, features),
    ...expandArgs(fabric ? fabric.arguments && fabric.arguments.jvm : [], env, features)
  ];
  if (logging) jvm.push(logging);

  const game = [
    ...expandArgs(vanilla.arguments.game, env, features),
    ...expandArgs(fabric ? fabric.arguments && fabric.arguments.game : [], env, features)
  ];

  const mainClass = fabric ? fabric.mainClass : vanilla.mainClass;
  const args = [...jvm.map((a) => substitute(a, vars)), mainClass, ...game.map((a) => substitute(a, vars))];
  return { args, mainClass, vars };
}

/** Skryje přístupový token ve výpisu příkazu (do logu). */
function redact(args, token) {
  return args.map((a) => (token && a === token ? '••••' : a));
}

function launch(javaPath, cmd, dirs, onLog) {
  fs.mkdirSync(dirs.game, { recursive: true });
  const child = spawn(javaPath, cmd.args, {
    cwd: dirs.game,
    detached: false,
    windowsHide: true,
    env: { ...process.env, JAVA_TOOL_OPTIONS: undefined }
  });
  child.stdout.on('data', (d) => onLog && onLog(d.toString()));
  child.stderr.on('data', (d) => onLog && onLog(d.toString()));
  return child;
}

module.exports = { buildCommand, launch, redact };
