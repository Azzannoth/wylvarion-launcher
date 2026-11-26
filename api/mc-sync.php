<?php
/* Wylvarion — příjem dat z pluginu WylWeb (statistiky hráčů, kódy pro přihlášení, ověření hesla). */
require __DIR__ . '/mc-sync-config.php';
require __DIR__ . '/_store.php';
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

if (!hash_equals(WYL_SYNC_SECRET, (string)($_SERVER['HTTP_X_WYL_SECRET'] ?? ''))) { http_response_code(403); exit('forbidden'); }
$action = (string)($_GET['action'] ?? '');
$in = json_decode((string)file_get_contents('php://input'), true) ?: [];

store_update('mcstate', function (&$d) { $d['seen'] = time(); });

if ($action === 'pubkey') {
    $key = (string)($in['key'] ?? '');
    if (strpos($key, 'BEGIN PUBLIC KEY') === false) { http_response_code(400); exit('bad key'); }
    store_update('mcstate', function (&$d) use ($key) { $d['pubkey'] = $key; });
    exit('ok');
}

if ($action === 'stats') {
    $players = is_array($in['players'] ?? null) ? $in['players'] : [];
    $online = $in['online'] ?? null;
    store_update('players', function (&$d) use ($players) {
        foreach ($players as $p) {
            $uuid = strtolower(preg_replace('/[^0-9a-fA-F-]/', '', (string)($p['uuid'] ?? '')));
            $name = preg_replace('/[^A-Za-z0-9_.]/', '', (string)($p['name'] ?? ''));
            if ($uuid === '' || $name === '') continue;
            $row = ['uuid' => $uuid, 'name' => $name];
            foreach (['first', 'last', 'play', 'kills', 'deaths', 'mobs', 'fish', 'walk', 'quests', 'vyp'] as $k) {
                if (isset($p[$k]) && is_numeric($p[$k]) && $p[$k] >= 0) $row[$k] = (int)$p[$k];
            }
            if (isset($p['money']) && is_numeric($p['money'])) $row['money'] = round((float)$p['money'], 2);
            if (isset($p['qrank']) && is_string($p['qrank']) && preg_match('/^[a-z_]{2,20}$/', $p['qrank'])) $row['qrank'] = $p['qrank'];
            $d[$uuid] = $row + ($d[$uuid] ?? []);
        }
    });
    if (is_array($online)) {
        $names = array_values(array_filter(array_map(fn($n) => preg_replace('/[^A-Za-z0-9_.]/', '', (string)$n), $online)));
        store_update('mcstate', function (&$d) use ($names, $in) { $d['online'] = !empty($in['shutdown']) ? [] : $names; $d['online_at'] = time(); });
    }
    exit('ok');
}

if ($action === 'code') {
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['code'] ?? '')));
    $name = preg_replace('/[^A-Za-z0-9_.]/', '', (string)($in['name'] ?? ''));
    if (strlen($code) !== 6 || $name === '') { http_response_code(400); exit('bad'); }
    store_update('mclogin', function (&$d) use ($code, $name, $in) {
        foreach ($d['codes'] ?? [] as $c => $v) if ($v['exp'] < time() || strtolower($v['name']) === strtolower($name)) unset($d['codes'][$c]);
        $d['codes'][$code] = ['name' => $name, 'uuid' => (string)($in['uuid'] ?? ''), 'exp' => time() + 600, 'tries' => 0];
    });
    exit('ok');
}

if ($action === 'poll') {
    $jobs = store_update('mclogin', function (&$d) {
        $out = [];
        foreach ($d['jobs'] ?? [] as $id => $j) {
            if ($j['created'] < time() - 60) { unset($d['jobs'][$id]); continue; }
            if (!empty($j['enc']) && empty($j['sent'])) {
                $out[] = $id . "\t" . $j['name'] . "\t" . $j['enc'];
                $d['jobs'][$id]['sent'] = time();
                $d['jobs'][$id]['enc'] = '';   // zašifrované heslo hned zahodit
            }
        }
        return $out;
    });
    exit(implode("\n", $jobs));
}

if ($action === 'result') {
    $id = preg_replace('/[^a-f0-9]/', '', (string)($in['id'] ?? ''));
    store_update('mclogin', function (&$d) use ($id, $in) {
        if (!isset($d['jobs'][$id])) return;
        $d['jobs'][$id]['done'] = true;
        $d['jobs'][$id]['ok'] = !empty($in['ok']);
        $d['jobs'][$id]['reason'] = substr((string)($in['reason'] ?? ''), 0, 30);
    });
    exit('ok');
}
http_response_code(400);
exit('unknown');
