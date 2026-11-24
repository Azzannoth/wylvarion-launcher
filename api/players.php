<?php
/* Wylvarion — hráči: vyhledávání, veřejné profily, Síň slávy, úprava vlastního profilu.
   GET q=nick            → našeptávač
   GET home=1            → online, naposledy aktivní, noví hráči
   GET nick=Nick         → profil
   GET top=play|money|kills|mobs|votes|fish → žebříček TOP 10
   POST {bio, frame}     → úprava vlastního profilu (jen po přihlášení Minecraft účtem) */
require __DIR__ . '/auth-lib.php';
require_once __DIR__ . '/config.php';
require __DIR__ . '/_store.php';

const FRAMES = [
    'basic'   => ['Základní', null],
    'voter'   => ['Hlasující', 'voter'],
    'veteran' => ['Veterán', 'hours500'],
    'legend'  => ['Legenda', 'hours1000'],
    'sponsor' => ['Sponzor', 'sponsor'],
    'team'    => ['Admin Team', 'team'],
];
const BADGES = [
    'team'      => ['Admin Team', 'Člen admin teamu Wylvarionu', '🛡️'],
    'sponsor'   => ['Sponzor', 'Podporuje server jako sponzor', '💎'],
    'veteran'   => ['Veterán', 'Na serveru déle než rok', '🏰'],
    'hours10'   => ['Nováček', 'Odehráno 10 hodin', '🌱'],
    'hours100'  => ['Stálice', 'Odehráno 100 hodin', '⏳'],
    'hours500'  => ['Legenda', 'Odehráno 500 hodin', '🔥'],
    'hours1000' => ['Nesmrtelný', 'Odehráno 1000 hodin', '👑'],
    'voter'     => ['Hlasující', 'Aspoň 50 hlasů pro server', '🗳️'],
    'voter2'    => ['Věrný hlas', 'Aspoň 250 hlasů pro server', '📜'],
    'fighter'   => ['Bojovník', 'Aspoň 100 zabitých hráčů', '⚔️'],
    'hunter'    => ['Lovec', 'Aspoň 5000 zabitých mobů', '🏹'],
    'fisher'    => ['Rybář', 'Aspoň 500 chycených ryb', '🎣'],
    'traveler'  => ['Cestovatel', 'Nachozeno přes 1000 km', '🧭'],
    'clean'     => ['Čistý štít', 'Přes 20 hodin hraní a žádný trest', '🕊️'],
    'rich'      => ['Boháč', 'TOP 10 nejbohatších hráčů', '💰'],
    'topplay'   => ['Nehasnoucí', 'TOP 10 v odehraném čase', '🏆'],
];

function pl_all(): array { return store_load('players'); }
function pl_find(array $all, string $nick): ?array {
    $n = strtolower($nick);
    $best = null;
    foreach ($all as $p) if (strtolower($p['name']) === $n && (!$best || ($p['last'] ?? 0) > ($best['last'] ?? 0))) $best = $p;
    return $best;
}
function pl_hours(array $p): float { return isset($p['play']) ? $p['play'] / 20 / 3600 : 0; }
function pl_top(array $all, string $field, int $n = 10): array {
    $rows = array_filter($all, fn($p) => isset($p[$field]) && $p[$field] > 0);
    usort($rows, fn($a, $b) => $b[$field] <=> $a[$field]);
    return array_slice(array_values($rows), 0, $n);
}
function pl_team(): array {
    $out = [];
    foreach (require __DIR__ . '/../includes/data/team.php' as $g)
        foreach ($g['members'] as $m) if ($m['nick'] !== 'Volná pozice') $out[strtolower($m['nick'])] = $m['role'];
    return $out;
}
function pl_sponsors(): array {
    $d = json_decode((string)@file_get_contents(__DIR__ . '/sponsors_data.json'), true);
    $out = [];
    foreach ($d['sponsors'] ?? [] as $s) if (!empty($s['active'])) $out[strtolower($s['nickname'])] = true;
    return $out;
}
function pl_votes(string $nick): ?array {
    try {
        $st = get_db('votes')->prepare("SELECT * FROM VotingPlugin_Users WHERE PlayerName = ? LIMIT 1");
        $st->execute([$nick]);
        $v = $st->fetch();
        return $v ? ['month' => (int)($v['MonthTotal'] ?? 0), 'total' => (int)($v['AllTimeTotal'] ?? 0)] : null;
    } catch (Throwable $e) { return null; }
}
function pl_online(): array {
    $s = store_load('mcstate');
    if (empty($s['online_at']) || $s['online_at'] < time() - 900) return [];
    return array_map('strtolower', $s['online'] ?? []);
}
function pl_public(array $p, array $online): array {
    return ['name' => $p['name'], 'online' => in_array(strtolower($p['name']), $online, true),
            'hours' => round(pl_hours($p), 1), 'first' => $p['first'] ?? null, 'last' => $p['last'] ?? null];
}

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST') {
    auth_start();
    if (empty($_SESSION['nick']) || empty($_SESSION['mc_verified'])) wyl_json(403, ['ok' => false, 'error' => 'Profil si můžeš upravit po přihlášení Minecraft účtem (heslem nebo kódem ze hry).']);
    $in = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $nick = strtolower($_SESSION['nick']);
    $bio = trim(preg_replace('/\s+/u', ' ', strip_tags((string)($in['bio'] ?? ''))));
    $bio = mb_substr($bio, 0, 160);
    $frame = (string)($in['frame'] ?? 'basic');
    if (!isset(FRAMES[$frame])) $frame = 'basic';
    store_update('profiles', function (&$d) use ($nick, $bio, $frame) { $d[$nick] = ['bio' => $bio, 'frame' => $frame, 'updated' => time()]; });
    wyl_json(200, ['ok' => true]);
}

header('Cache-Control: public, max-age=20');
$all = pl_all();
$online = pl_online();

if (isset($_GET['q'])) {
    $q = strtolower(preg_replace('/[^A-Za-z0-9_.]/', '', (string)$_GET['q']));
    $out = [];
    if (strlen($q) >= 1) {
        foreach ($all as $p) if (strpos(strtolower($p['name']), $q) === 0) $out[] = $p;
        if (count($out) < 8) foreach ($all as $p) if (strpos(strtolower($p['name']), $q) > 0) $out[] = $p;
        usort($out, fn($a, $b) => (strpos(strtolower($a['name']), $q) <=> strpos(strtolower($b['name']), $q)) ?: (($b['last'] ?? 0) <=> ($a['last'] ?? 0)));
    }
    wyl_json(200, ['ok' => true, 'players' => array_map(fn($p) => pl_public($p, $online), array_slice($out, 0, 8))]);
}

if (isset($_GET['home'])) {
    $byLast = array_values($all); usort($byLast, fn($a, $b) => ($b['last'] ?? 0) <=> ($a['last'] ?? 0));
    $byFirst = array_values($all); usort($byFirst, fn($a, $b) => ($b['first'] ?? 0) <=> ($a['first'] ?? 0));
    $on = array_values(array_filter($all, fn($p) => in_array(strtolower($p['name']), $online, true)));
    wyl_json(200, ['ok' => true, 'connected' => count($all) > 0, 'count' => count($all),
        'online' => array_map(fn($p) => pl_public($p, $online), $on),
        'recent' => array_map(fn($p) => pl_public($p, $online), array_slice($byLast, 0, 12)),
        'newest' => array_map(fn($p) => pl_public($p, $online), array_slice($byFirst, 0, 8))]);
}

if (isset($_GET['top'])) {
    $field = (string)$_GET['top'];
    if ($field === 'votes') {
        try {
            $rows = get_db('votes')->query("SELECT PlayerName AS name, AllTimeTotal AS v FROM VotingPlugin_Users WHERE AllTimeTotal > 0 ORDER BY AllTimeTotal DESC LIMIT 10")->fetchAll();
            wyl_json(200, ['ok' => true, 'top' => array_map(fn($r) => ['name' => $r['name'], 'value' => (int)$r['v']], $rows)]);
        } catch (Throwable $e) { wyl_json(200, ['ok' => true, 'top' => []]); }
    }
    if (!in_array($field, ['play', 'money', 'kills', 'mobs', 'fish', 'walk'], true)) wyl_json(400, ['ok' => false]);
    $rows = pl_top($all, $field, 10);
    wyl_json(200, ['ok' => true, 'connected' => count($all) > 0, 'top' => array_map(fn($p) => ['name' => $p['name'], 'value' => $p[$field],
        'online' => in_array(strtolower($p['name']), $online, true)], array_slice(array_values($rows), 0, 10))]);
}

$nick = preg_replace('/[^A-Za-z0-9_.]/', '', (string)($_GET['nick'] ?? ''));
if ($nick === '') wyl_json(400, ['ok' => false, 'error' => 'Chybí nick.']);
$p = pl_find($all, $nick);
$team = pl_team();
$sponsors = pl_sponsors();
$key = strtolower($p['name'] ?? $nick);
$votes = pl_votes($p['name'] ?? $nick);
$prof = store_load('profiles')[$key] ?? [];

// tresty z LiteBans (jen počty a jestli je teď aktivní)
$pun = ['total' => 0, 'active' => null];
try {
    $pfx = LITEBANS_PREFIX;
    $pdo = get_db();
    $uuid = $p['uuid'] ?? null;
    if (!$uuid) { $st = $pdo->prepare("SELECT uuid FROM {$pfx}history WHERE name = ? ORDER BY date DESC LIMIT 1"); $st->execute([$nick]); $uuid = $st->fetchColumn() ?: null; }
    $hidden = array_map('strtolower', require __DIR__ . '/_hidden_players.php');
    if ($uuid && !in_array($key, $hidden, true)) {
        foreach (['bans' => 'BAN', 'mutes' => 'MUTE', 'warnings' => 'WARN', 'kicks' => 'KICK'] as $t => $T) {
            $st = $pdo->prepare("SELECT COUNT(*) FROM {$pfx}{$t} WHERE uuid = ? AND LOWER(TRIM(reason)) <> 'test'");
            $st->execute([$uuid]); $pun['total'] += (int)$st->fetchColumn();
        }
        $st = $pdo->prepare("SELECT COUNT(*) FROM {$pfx}bans WHERE uuid = ? AND active = 1 AND (until <= 0 OR until > ?)");
        $st->execute([$uuid, time() * 1000]);
        if ($st->fetchColumn() > 0) $pun['active'] = 'BAN';
        else {
            $st = $pdo->prepare("SELECT COUNT(*) FROM {$pfx}mutes WHERE uuid = ? AND active = 1 AND (until <= 0 OR until > ?)");
            $st->execute([$uuid, time() * 1000]);
            if ($st->fetchColumn() > 0) $pun['active'] = 'MUTE';
        }
        if (!$p) {
            $st = $pdo->prepare("SELECT MIN(date) f, MAX(date) l, (SELECT name FROM {$pfx}history WHERE uuid = ? ORDER BY date DESC LIMIT 1) n FROM {$pfx}history WHERE uuid = ?");
            $st->execute([$uuid, $uuid]); $h = $st->fetch();
            if ($h && $h['n']) $p = ['uuid' => $uuid, 'name' => $h['n'], 'first' => strtotime($h['f']) * 1000, 'last' => strtotime($h['l']) * 1000, 'partial' => true];
        }
    }
} catch (Throwable $e) { /* banlist je jen doplněk */ }

if (!$p && !$votes && !isset($team[$key])) wyl_json(404, ['ok' => false, 'error' => 'Hráč s tímhle nickem na Wylvarionu nehrál.']);

$h = $p ? pl_hours($p) : 0;
$has = [];
if (isset($team[$key])) $has[] = 'team';
if (isset($sponsors[$key])) $has[] = 'sponsor';
if (!empty($p['first']) && $p['first'] < (time() - 365 * 86400) * 1000) $has[] = 'veteran';
foreach ([10 => 'hours10', 100 => 'hours100', 500 => 'hours500', 1000 => 'hours1000'] as $lim => $b) if ($h >= $lim) $has[] = $b;
if (($votes['total'] ?? 0) >= 50) $has[] = 'voter';
if (($votes['total'] ?? 0) >= 250) $has[] = 'voter2';
if (($p['kills'] ?? 0) >= 100) $has[] = 'fighter';
if (($p['mobs'] ?? 0) >= 5000) $has[] = 'hunter';
if (($p['fish'] ?? 0) >= 500) $has[] = 'fisher';
if (($p['walk'] ?? 0) >= 100000000) $has[] = 'traveler';
if ($h >= 20 && $pun['total'] === 0) $has[] = 'clean';
if ($p && in_array($p['uuid'] ?? '', array_column(pl_top($all, 'money'), 'uuid'), true)) $has[] = 'rich';
if ($p && in_array($p['uuid'] ?? '', array_column(pl_top($all, 'play'), 'uuid'), true)) $has[] = 'topplay';

$frames = [];
foreach (FRAMES as $id => [$label, $need]) $frames[] = ['id' => $id, 'name' => $label, 'unlocked' => $need === null || in_array($need, $has, true)];
$frame = $prof['frame'] ?? 'basic';
if (!in_array($frame, array_column(array_filter($frames, fn($f) => $f['unlocked']), 'id'), true)) $frame = 'basic';

auth_start();
$own = !empty($_SESSION['mc_verified']) && strtolower($_SESSION['nick'] ?? '') === $key;

wyl_json(200, [
    'ok' => true,
    'name' => $p['name'] ?? $nick,
    'online' => in_array($key, $online, true),
    'connected' => count($all) > 0 && empty($p['partial']),
    'stats' => $p ? [
        'hours' => round($h, 1), 'first' => $p['first'] ?? null, 'last' => $p['last'] ?? null,
        'money' => $p['money'] ?? null, 'kills' => $p['kills'] ?? null, 'deaths' => $p['deaths'] ?? null,
        'mobs' => $p['mobs'] ?? null, 'fish' => $p['fish'] ?? null, 'km' => isset($p['walk']) ? round($p['walk'] / 100000, 1) : null,
    ] : null,
    'votes' => $votes,
    'team' => $team[$key] ?? null,
    'sponsor' => isset($sponsors[$key]),
    'punishments' => $pun,
    'bio' => $prof['bio'] ?? '',
    'frame' => $frame,
    'frames' => $frames,
    'badges' => array_map(fn($id) => ['id' => $id, 'name' => BADGES[$id][0], 'desc' => BADGES[$id][1], 'icon' => BADGES[$id][2], 'has' => in_array($id, $has, true)], array_keys(BADGES)),
    'own' => $own,
]);
