'use strict';
// Server List Ping – zjistí počet hráčů online přímo ze serveru (bez služeb třetích stran).

const net = require('net');
const dns = require('dns').promises;

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let num = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    num |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error('VarInt je příliš dlouhý');
  }
  return { value: num, size: pos - offset };
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

async function resolveSrv(host, port) {
  try {
    const recs = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (recs.length) return { host: recs[0].name, port: recs[0].port };
  } catch {
    /* žádný SRV záznam */
  }
  return { host, port };
}

function textOf(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  return (desc.text || '') + (desc.extra || []).map(textOf).join('');
}

async function ping(host, port = 25565, timeout = 5000) {
  const target = await resolveSrv(host, port);
  return new Promise((resolve, reject) => {
    const sock = net.connect(target.port, target.host);
    let buf = Buffer.alloc(0);
    const start = Date.now();
    const done = (err, val) => {
      sock.destroy();
      clearTimeout(t);
      err ? reject(err) : resolve(val);
    };
    const t = setTimeout(() => done(new Error('Server neodpovídá')), timeout);
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varint(767), mcString(host), portBuf, varint(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarint(buf, len.size);
        const strLen = readVarint(buf, len.size + id.size);
        const start2 = len.size + id.size + strLen.size;
        const json = JSON.parse(buf.slice(start2, start2 + strLen.value).toString('utf8'));
        done(null, {
          online: true,
          players: json.players ? json.players.online : 0,
          max: json.players ? json.players.max : 0,
          version: json.version ? json.version.name : '',
          motd: textOf(json.description).replace(/§./g, ''),
          // jména hráčů online (server jich posílá jen pár, jména se skrytým profilem vynecháme)
          list: ((json.players && json.players.sample) || [])
            .map((p) => String(p.name || '').replace(/§./g, ''))
            .filter((n) => /^[A-Za-z0-9_]{2,16}$/.test(n)),
          ping: Date.now() - start
        });
      } catch (e) {
        done(e);
      }
    });
    sock.on('error', (e) => done(e));
  });
}

module.exports = { ping, varint, readVarint };
