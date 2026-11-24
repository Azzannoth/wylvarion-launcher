<?php
/* Wylvarion — přihlášení na web Minecraft účtem:
   - kódem ze hry (/web kod),
   - heslem z Minecraftu (AuthMe) – heslo se zašifruje veřejným klíčem pluginu a ověří ho server.
   GET            → je propojení se serverem aktivní?
   POST {action:"code", nick, code, remember}
   POST {action:"password", nick, password, remember} → {job}
   GET  job=ID    → stav ověření hesla */
require __DIR__ . '/auth-lib.php';
require __DIR__ . '/_store.php';
auth_start();

function mc_finish_login(string $nick, bool $remember): void {
    session_regenerate_id(true);
    $_SESSION['nick'] = $nick;
    $_SESSION['role'] = 'member';
    $_SESSION['mc_verified'] = true;
    $p = session_get_cookie_params();
    setcookie(session_name(), session_id(), [
        'expires' => $remember ? time() + 60 * 60 * 24 * 30 : 0,
        'path' => '/', 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

$state = store_load('mcstate');
$online = !empty($state['seen']) && $state['seen'] > time() - 120;

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $job = preg_replace('/[^a-f0-9]/', '', (string)($_GET['job'] ?? ''));
    if ($job === '') wyl_json(200, ['ok' => true, 'server' => $online, 'password' => $online && !empty($state['pubkey'])]);
    $mine = $_SESSION['mc_jobs'][$job] ?? null;
    if (!$mine) wyl_json(404, ['ok' => false, 'error' => 'Neznámé přihlášení.']);
    $d = store_load('mclogin');
    $j = $d['jobs'][$job] ?? null;
    if (!$j) wyl_json(200, ['ok' => false, 'done' => true, 'error' => 'Server neodpověděl, zkus to prosím znovu.']);
    if (empty($j['done'])) wyl_json(200, ['ok' => true, 'done' => false]);
    store_update('mclogin', function (&$x) use ($job) { unset($x['jobs'][$job]); });
    unset($_SESSION['mc_jobs'][$job]);
    if (!empty($j['ok'])) {
        mc_finish_login($j['name'], !empty($mine['remember']));
        wyl_json(200, ['ok' => true, 'done' => true, 'nick' => $j['name']]);
    }
    usleep(500000);
    $msg = ['not_registered' => 'Tento nick na serveru není zaregistrovaný.', 'bad_password' => 'Špatný nick nebo heslo.', 'no_authme' => 'Přihlášení heslem teď nejde, použij kód ze hry.'][$j['reason']] ?? 'Ověření se nepovedlo, zkus to znovu.';
    wyl_json(200, ['ok' => false, 'done' => true, 'error' => $msg]);
}

$in = json_decode((string)file_get_contents('php://input'), true) ?: [];
$action = (string)($in['action'] ?? '');
$nick = trim((string)($in['nick'] ?? ''));
$remember = !empty($in['remember']);
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (!preg_match('/^[A-Za-z0-9_.]{3,17}$/', $nick)) wyl_json(400, ['ok' => false, 'error' => 'Zadej svůj nick z Minecraftu.']);
if (!wyl_rate_limit('mclogin:' . $ip, 12, 600)) wyl_json(429, ['ok' => false, 'error' => 'Moc pokusů, zkus to prosím za pár minut.']);

if ($action === 'code') {
    $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['code'] ?? '')));
    $res = store_update('mclogin', function (&$d) use ($code, $nick) {
        $c = $d['codes'][$code] ?? null;
        if (!$c || $c['exp'] < time()) return 'bad';
        if (strtolower($c['name']) !== strtolower($nick)) return 'bad';
        unset($d['codes'][$code]);
        return $c['name'];
    });
    if ($res === 'bad') { usleep(600000); wyl_json(403, ['ok' => false, 'error' => 'Kód nesedí nebo už vypršel. Napiš ve hře /web a zkus nový.']); }
    mc_finish_login($res, $remember);
    wyl_json(200, ['ok' => true, 'nick' => $res]);
}

if ($action === 'password') {
    $pass = (string)($in['password'] ?? '');
    if ($pass === '' || strlen($pass) > 128) wyl_json(400, ['ok' => false, 'error' => 'Zadej heslo.']);
    if (!$online || empty($state['pubkey'])) wyl_json(503, ['ok' => false, 'error' => 'Server je teď offline, přihlas se prosím kódem později nebo přes Discord.']);
    $enc = '';
    if (!openssl_public_encrypt($pass, $enc, $state['pubkey'], OPENSSL_PKCS1_OAEP_PADDING)) wyl_json(500, ['ok' => false, 'error' => 'Šifrování se nepovedlo.']);
    $id = bin2hex(random_bytes(10));
    store_update('mclogin', function (&$d) use ($id, $nick, $enc) {
        $d['jobs'][$id] = ['name' => $nick, 'enc' => base64_encode($enc), 'created' => time()];
    });
    $_SESSION['mc_jobs'][$id] = ['remember' => $remember];
    wyl_json(200, ['ok' => true, 'job' => $id]);
}
wyl_json(400, ['ok' => false, 'error' => 'Neznámá akce.']);
