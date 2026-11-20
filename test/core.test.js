'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const rules = require('../src/main/core/rules');
const { mavenPath, layout } = require('../src/main/core/paths');
const { collectLibraries, libKey } = require('../src/main/core/minecraft');
const { buildCommand, redact } = require('../src/main/core/launch');
const { varint, readVarint } = require('../src/main/core/status');
const { gpuTier } = require('../src/main/core/mods');
const { pkce, authorizeUrl } = require('../src/main/core/auth');

const win = { name: 'windows', arch: 'x64' };
const linux = { name: 'linux', arch: 'x64' };

test('rules: os allow/disallow', () => {
  const r = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }];
  assert.equal(rules.allowed(r, win), true);
  assert.equal(rules.allowed(r, { name: 'osx', arch: 'arm64' }), false);
  assert.equal(rules.allowed([{ action: 'allow', os: { name: 'windows' } }], linux), false);
});

test('rules: features + substitute', () => {
  const args = ['--a', { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }];
  assert.deepEqual(rules.expandArgs(args, win, {}), ['--a']);
  const out = rules.expandArgs(args, win, { is_quick_play_multiplayer: true }).map((a) => rules.substitute(a, { quickPlayMultiplayer: 'play.wylvarion.cz' }));
  assert.deepEqual(out, ['--a', '--quickPlayMultiplayer', 'play.wylvarion.cz']);
  assert.equal(rules.substitute('${unknown}', {}), '${unknown}');
});

test('mavenPath', () => {
  assert.equal(mavenPath('net.fabricmc:fabric-loader:0.20.1').replace(/\\/g, '/'), 'net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar');
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.3.3:natives-windows').replace(/\\/g, '/'), 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar');
});

test('collectLibraries: fabric overrides vanilla ASM, natives picked', () => {
  const dirs = layout('/tmp/wyl');
  const vanilla = {
    libraries: [
      { name: 'org.ow2.asm:asm:9.6', downloads: { artifact: { path: 'org/ow2/asm/asm/9.6/asm-9.6.jar', url: 'https://x/asm96', sha1: 'a' } } },
      { name: 'org.lwjgl:lwjgl:3.3.3:natives-windows', downloads: { artifact: { path: 'n.jar', url: 'https://x/n', sha1: 'b' } }, rules: [{ action: 'allow', os: { name: 'windows' } }] },
      { name: 'org.lwjgl:lwjgl:3.3.3:natives-linux', downloads: { artifact: { path: 'l.jar', url: 'https://x/l', sha1: 'c' } }, rules: [{ action: 'allow', os: { name: 'linux' } }] }
    ]
  };
  const fabric = { libraries: [{ name: 'org.ow2.asm:asm:9.8', url: 'https://maven.fabricmc.net/' }] };
  const libs = collectLibraries(dirs, vanilla, fabric, win);
  const asm = libs.classpath.filter((l) => l.name.startsWith('org.ow2.asm:asm:'));
  assert.equal(asm.length, 1);
  assert.equal(asm[0].name, 'org.ow2.asm:asm:9.8');
  assert.equal(libs.natives.length, 1);
  assert.match(libs.natives[0].name, /natives-windows/);
  assert.notEqual(libKey('a:b:1'), libKey('a:b:1:natives-windows'));
});

test('buildCommand: quick play, memory, token redaction', () => {
  const dirs = layout('/tmp/wyl');
  const install = {
    vanilla: {
      id: '26.3',
      mainClass: 'net.minecraft.client.main.Main',
      assetIndex: { id: '30' },
      arguments: {
        jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
        game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }]
      }
    },
    fabric: { id: 'fabric-loader-0.20.1-26.3', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '], game: [] } },
    clientJar: '/tmp/wyl/client.jar',
    libs: { classpath: [{ path: '/tmp/a.jar' }, { path: '/tmp/b.jar' }] },
    nativesDir: '/tmp/wyl/natives',
    logging: null
  };
  const cmd = buildCommand({ install, dirs, account: { name: 'Steve', uuid: 'u', accessToken: 'SECRET' }, server: { host: 'play.wylvarion.cz', port: 25565 }, memoryMb: 6144, env: linux });
  assert.equal(cmd.mainClass, 'net.fabricmc.loader.impl.launch.knot.KnotClient');
  assert.ok(cmd.args.includes('-Xmx6144M'));
  assert.ok(cmd.args.includes('/tmp/a.jar:/tmp/b.jar:/tmp/wyl/client.jar'));
  const i = cmd.args.indexOf('--quickPlayMultiplayer');
  assert.equal(cmd.args[i + 1], 'play.wylvarion.cz');
  assert.ok(!cmd.args.some((a) => a.includes('${')));
  assert.ok(!redact(cmd.args, 'SECRET').includes('SECRET'));
  const winCmd = buildCommand({ install, dirs, account: { name: 'S', uuid: 'u', accessToken: 't' }, server: { host: 'h', port: 25570 }, memoryMb: 4096, env: win });
  assert.ok(winCmd.args.includes('/tmp/a.jar;/tmp/b.jar;/tmp/wyl/client.jar'));
  assert.equal(winCmd.args[winCmd.args.indexOf('--quickPlayMultiplayer') + 1], 'h:25570');
});

test('varint roundtrip', () => {
  for (const n of [0, 1, 127, 128, 300, 25565, 2147483647]) {
    const buf = varint(n);
    assert.equal(readVarint(buf, 0).value, n);
  }
});

test('gpuTier', () => {
  const g = (s) => gpuTier({ gpuDevice: [{ vendorString: '', deviceString: s }] });
  assert.equal(g('NVIDIA GeForce RTX 3060'), 'high');
  assert.equal(g('Intel(R) UHD Graphics 620'), 'low');
  assert.equal(g('NVIDIA GeForce MX150'), 'medium');
  assert.equal(gpuTier(null), 'low');
});

test('pkce + authorizeUrl', () => {
  const p = pkce();
  assert.ok(p.verifier.length >= 43);
  const u = new URL(authorizeUrl('abc', 'https://login.microsoftonline.com/common/oauth2/nativeclient', p.challenge, 'st'));
  assert.equal(u.searchParams.get('client_id'), 'abc');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('scope'), /XboxLive\.signin/);
});
