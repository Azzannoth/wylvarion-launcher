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

test('servers.dat: přidá Wylvarion s povoleným resource packem a zachová ostatní servery', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { ensureServer, _nbt } = require('../src/main/core/servers');
  const { reader, writer, T } = _nbt;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wylsrv-'));
  const server = { name: 'Wylvarion', host: 'play.wylvarion.cz', port: 25565 };
  const read = () => reader(fs.readFileSync(path.join(dir, 'servers.dat'))).root().value.find((e) => e.name === 'servers').value.items;
  const field = (s, n) => (s.find((e) => e.name === n) || {}).value;

  // nový soubor
  assert.equal(ensureServer(dir, server), true);
  let items = read();
  assert.equal(items.length, 1);
  assert.equal(field(items[0], 'ip'), 'play.wylvarion.cz');
  assert.equal(field(items[0], 'acceptTextures'), 1);
  assert.equal(ensureServer(dir, server), false);

  // existující seznam s jiným serverem a skrytým záznamem z Quick Play
  const other = [{ type: T.STRING, name: 'name', value: 'Jiný' }, { type: T.STRING, name: 'ip', value: 'mc.example.com' }, { type: T.STRING, name: 'icon', value: 'abc' }];
  const hidden = [{ type: T.STRING, name: 'name', value: 'Minecraft Server' }, { type: T.STRING, name: 'ip', value: 'play.wylvarion.cz' }, { type: T.BYTE, name: 'hidden', value: 1 }];
  const buf = writer().root('', [{ type: T.LIST, name: 'servers', value: { type: T.COMPOUND, items: [other, hidden] } }]);
  fs.writeFileSync(path.join(dir, 'servers.dat'), buf);
  assert.equal(ensureServer(dir, server), true);
  items = read();
  assert.equal(items.length, 2);
  assert.equal(field(items[0], 'icon'), 'abc');
  assert.equal(field(items[1], 'acceptTextures'), 1);
  assert.equal(field(items[1], 'hidden'), 1);
  // zápis a čtení dají stejná data
  const again = fs.readFileSync(path.join(dir, 'servers.dat'));
  const r = reader(again).root();
  assert.deepEqual(writer().root(r.name, r.value), again);
});

test('skins: kontrola PNG, knihovna a odeslání na Mojang API', async () => {
  const fs = require('fs');
  const os = require('os');
  const zlib = require('zlib');
  const skins = require('../src/main/core/skins');
  const png = (w, h) => {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  const ok = png(64, 64);
  assert.deepEqual(skins.pngSize(ok), { width: 64, height: 64 });
  skins.checkSkin(ok);
  skins.checkSkin(png(64, 32));
  assert.throws(() => skins.checkSkin(png(128, 128)), /64×64/);
  assert.throws(() => skins.checkSkin(Buffer.from('nope')), /PNG/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wylskin-'));
  const lib = skins.library(dir);
  const id = lib.add(ok, 'Rytíř', 'slim');
  assert.equal(lib.add(ok, 'Rytíř 2', 'slim'), id); // stejný obrázek se neuloží dvakrát
  assert.equal(lib.list().length, 1);
  assert.equal(lib.list()[0].name, 'Rytíř 2');
  assert.ok(lib.get(id).png.equals(ok));
  lib.remove(id);
  assert.equal(lib.list().length, 0);

  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/capes/active') && opts.method === 'PUT') return new Response('{"errorMessage":"cape not owned"}', { status: 400 });
    return new Response(JSON.stringify({ id: 'u', name: 'Hrac', skins: [{ state: 'ACTIVE', url: 'http://textures.minecraft.net/texture/x', variant: 'SLIM' }], capes: [] }), { status: 200 });
  };
  try {
    const prof = await skins.upload('TOKEN', ok, 'slim');
    assert.equal(calls[0].url, 'https://api.minecraftservices.com/minecraft/profile/skins');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer TOKEN');
    assert.equal(calls[0].opts.body.get('variant'), 'slim');
    assert.equal((await calls[0].opts.body.get('file').arrayBuffer()).byteLength, ok.length);
    assert.deepEqual(skins.activeSkin(prof), { url: 'http://textures.minecraft.net/texture/x', variant: 'SLIM' });
    await assert.rejects(skins.setCape('TOKEN', 'abc'), /cape not owned/);
    await skins.setCape('TOKEN', null);
    assert.equal(calls.at(-1).opts.method, 'DELETE');
    assert.equal(calls.length, 3); // změny se při chybě neopakují
  } finally {
    global.fetch = realFetch;
  }
});
