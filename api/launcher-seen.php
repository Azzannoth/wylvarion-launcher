<?php
/**
 * api/launcher-seen.php – launcher hlásí, že hráč spouští hru s resource packem nainstalovaným z launcheru.
 * POST {"name":"Nick"}  → uloží čas.
 * GET  ?name=Nick       → {"launcher":true} když se hráč ohlásil za posledních 24 h (čte plugin WylPack).
 * Je to jen kosmetika (obrázky ranků v tabu), proto bez přihlášení; nick se jen ukládá.
 */
require __DIR__ . '/_store.php';
header('Cache-Control: no-store');

const LS_TTL = 86400;

function ls_name($v): string {
    $v = is_string($v) ? trim($v) : '';
    return preg_match('/^[A-Za-z0-9_.]{2,20}$/', $v) ? strtolower($v) : '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!wyl_rate_limit('ls' . substr(md5((string) ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 10), 20, 3600)) wyl_json(429, ['ok' => false]);
    $in = json_decode((string) file_get_contents('php://input'), true);
    $name = ls_name($in['name'] ?? '');
    if ($name === '') wyl_json(400, ['ok' => false]);
    store_update('launcher-seen', function (array &$d) use ($name) {
        $now = time();
        foreach ($d as $k => $t) if ($t < $now - LS_TTL) unset($d[$k]);
        $d[$name] = $now;
    });
    wyl_json(200, ['ok' => true]);
}

$name = ls_name($_GET['name'] ?? '');
$d = store_load('launcher-seen');
wyl_json(200, ['ok' => true, 'launcher' => $name !== '' && isset($d[$name]) && $d[$name] >= time() - LS_TTL]);
