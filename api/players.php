<?php
/* Wylvarion — hráči: vyhledávání, veřejné profily, Síň slávy, úprava vlastního profilu.
   GET q=nick            → našeptávač
   GET home=1            → online, naposledy aktivní, noví hráči
   GET nick=Nick         → profil
   GET top=play|money|kills|mobs|votes|fish|quests|vyp|badges → žebříček TOP 10
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
    'patron'  => ['Patron', 'patron'],
    'collector' => ['Sběratel', 'collector'],
    'mythic'  => ['Mýtus', 'quest2500'],
];
// [název, popis, ikona, vzácnost c/r/e/l]
const BADGES = [
    'team'       => ['Admin Team', 'Člen admin teamu Wylvarionu', '🛡️', 'l'],
    'plegend'    => ['Legendární patron', 'Podpořil server částkou 15 000 Kč a víc', '🌟', 'l'],
    'pmecenas'   => ['Mecenáš', 'Podpořil server částkou 5 000 Kč a víc', '🏛️', 'e'],
    'patron'     => ['Patron', 'Podpořil server částkou 1 000 Kč a víc', '🎗️', 'r'],
    'sponsor'    => ['Sponzor', 'Podporuje server jako sponzor', '💎', 'e'],
    'collector'  => ['Sběratel', 'Získáno aspoň 25 odznaků', '🏅', 'l'],
    'allround'   => ['Všeuměl', '100 h hraní, 100 questů, 1000 mobů a 100 ryb', '🎭', 'e'],
    'veteran2'   => ['Pradávný', 'Na serveru déle než 2 roky', '🗿', 'e'],
    'veteran'    => ['Veterán', 'Na serveru déle než rok', '🏰', 'r'],
    'hours10'    => ['Nováček', 'Odehráno 10 hodin', '🌱', 'c'],
    'hours50'    => ['Usedlík', 'Odehráno 50 hodin', '🏡', 'c'],
    'hours100'   => ['Stálice', 'Odehráno 100 hodin', '⏳', 'r'],
    'hours250'   => ['Pilíř komunity', 'Odehráno 250 hodin', '🧱', 'r'],
    'hours500'   => ['Legenda', 'Odehráno 500 hodin', '🔥', 'e'],
    'hours1000'  => ['Nesmrtelný', 'Odehráno 1000 hodin', '👑', 'l'],
    'voter0'     => ['První hlasy', 'Aspoň 10 hlasů pro server', '✉️', 'c'],
    'voter'      => ['Hlasující', 'Aspoň 50 hlasů pro server', '🗳️', 'r'],
    'voter2'     => ['Věrný hlas', 'Aspoň 250 hlasů pro server', '📜', 'e'],
    'voter3'     => ['Hlas lidu', 'Aspoň 1000 hlasů pro server', '📯', 'l'],
    'pvp10'      => ['Rváč', 'Aspoň 10 zabitých hráčů', '🥊', 'c'],
    'fighter'    => ['Bojovník', 'Aspoň 100 zabitých hráčů', '⚔️', 'r'],
    'warlord'    => ['Vojevůdce', 'Aspoň 500 zabitých hráčů', '🪖', 'e'],
    'pvpgod'     => ['Krvavý pán', 'Aspoň 2000 zabitých hráčů', '🩸', 'l'],
    'kd3'        => ['Nepřemožitelný', 'K/D aspoň 3 při 50+ zabitích', '🗡️', 'e'],
    'phoenix'    => ['Fénix', 'Zemřel 250× a pořád se vrací', '🐦‍🔥', 'r'],
    'mob500'     => ['Zabiják', 'Aspoň 500 zabitých mobů', '🔪', 'c'],
    'hunter'     => ['Lovec', 'Aspoň 5000 zabitých mobů', '🏹', 'r'],
    'slayer'     => ['Zhouba nestvůr', 'Aspoň 25 000 zabitých mobů', '🐲', 'e'],
    'butcher'    => ['Kat bestií', 'Aspoň 100 000 zabitých mobů', '☠️', 'l'],
    'fish50'     => ['Udičkář', 'Aspoň 50 chycených ryb', '🐟', 'c'],
    'fisher'     => ['Rybář', 'Aspoň 500 chycených ryb', '🎣', 'r'],
    'fish2500'   => ['Pán vod', 'Aspoň 2500 chycených ryb', '🐋', 'e'],
    'walk100'    => ['Poutník', 'Nachozeno 100 km', '👣', 'c'],
    'traveler'   => ['Cestovatel', 'Nachozeno 1000 km', '🧭', 'r'],
    'walk5000'   => ['Zeměměřič', 'Nachozeno 5000 km', '🗺️', 'e'],
    'walk20000'  => ['Obeplul svět', 'Nachozeno 20 000 km', '🌍', 'l'],
    'money100k'  => ['Podnikatel', 'Aspoň 100 000 na účtu', '💵', 'r'],
    'money1m'    => ['Milionář', 'Aspoň 1 000 000 na účtu', '🏦', 'e'],
    'clean'      => ['Čistý štít', 'Přes 20 hodin hraní a žádný trest', '🕊️', 'r'],
    'rich'       => ['Boháč', 'TOP 10 nejbohatších hráčů', '💰', 'e'],
    'topplay'    => ['Nehasnoucí', 'TOP 10 v odehraném čase', '🏆', 'e'],
    'topquest'   => ['Mistr úkolů', 'TOP 10 ve splněných questech', '🎖️', 'e'],
    'topkill'    => ['Postrach arény', 'TOP 10 v zabitích hráčů', '🔱', 'e'],
    'quest10'    => ['Učedník', 'Splněno 10 questů', '🪶', 'c'],
    'quest100'   => ['Dobrodruh', 'Splněno 100 questů', '📗', 'c'],
    'quest500'   => ['Hrdina', 'Splněno 500 questů', '🛡', 'r'],
    'quest1000'  => ['Prastarý', 'Splněno 1000 questů – odemčené Výpravy Prastarých', '✦', 'e'],
    'quest2500'  => ['Mýtus', 'Splněno 2500 questů', '🌠', 'l'],
    'cq1'        => ['Pomocná ruka', 'Přispěl do komunitního questu', '🤝', 'c'],
    'cq10'       => ['Duše komunity', 'Přispěl do 10 komunitních questů', '💞', 'e'],
    'cq5000'     => ['Tahoun komunity', 'Celkem 5000 bodů v komunitních questech', '🏗️', 'l'],
    'vyp1'       => ['Na výpravě', 'První splněná Výprava Prastarých', '🧳', 'r'],
    'vyp25'      => ['Průzkumník věků', '25 splněných Výprav Prastarých', '🔮', 'e'],
    'vyp100'     => ['Strážce věků', 'Dokončeno celé kolo (100) Výprav Prastarých', '🌌', 'l'],
];
// odznaky za hodnotu: id => [pole, potřeba] (pole 'hours', 'km', 'votes' se počítají zvlášť)
const BADGE_GOALS = [
    'hours10' => ['hours', 10], 'hours50' => ['hours', 50], 'hours100' => ['hours', 100], 'hours250' => ['hours', 250], 'hours500' => ['hours', 500], 'hours1000' => ['hours', 1000],
    'voter0' => ['votes', 10], 'voter' => ['votes', 50], 'voter2' => ['votes', 250], 'voter3' => ['votes', 1000],
    'pvp10' => ['kills', 10], 'fighter' => ['kills', 100], 'warlord' => ['kills', 500], 'pvpgod' => ['kills', 2000],
    'phoenix' => ['deaths', 250],
    'mob500' => ['mobs', 500], 'hunter' => ['mobs', 5000], 'slayer' => ['mobs', 25000], 'butcher' => ['mobs', 100000],
    'fish50' => ['fish', 50], 'fisher' => ['fish', 500], 'fish2500' => ['fish', 2500],
    'walk100' => ['km', 100], 'traveler' => ['km', 1000], 'walk5000' => ['km', 5000], 'walk20000' => ['km', 20000],
    'money100k' => ['money', 100000], 'money1m' => ['money', 1000000],
    'quest10' => ['quests', 10], 'quest100' => ['quests', 100], 'quest500' => ['quests', 500], 'quest1000' => ['quests', 1000], 'quest2500' => ['quests', 2500],
    'cq1' => ['cqn', 1], 'cq10' => ['cqn', 10], 'cq5000' => ['cq', 5000],
    'vyp1' => ['vyp', 1], 'vyp25' => ['vyp', 25], 'vyp100' => ['vyp', 100],
];
const BADGE_RANK = ['l' => 4, 'e' => 3, 'r' => 2, 'c' => 1];

/** příspěvky do komunitních questů: uuid => [amount, quests] */
function pl_cq(): array {
    static $t = null;
    if ($t !== null) return $t;
    $t = [];
    foreach (store_load('cqhist') as $h) foreach ($h['players'] ?? [] as $uuid => $p) {
        if (($p['amount'] ?? 0) <= 0) continue;
        $t[$uuid]['amount'] = ($t[$uuid]['amount'] ?? 0) + $p['amount'];
        $t[$uuid]['quests'] = ($t[$uuid]['quests'] ?? 0) + 1;
    }
    return $t;
}
function pl_metric(?array $p, string $m, array $ctx): float {
    if (!$p && $m !== 'votes') return 0;
    if ($m === 'hours') return pl_hours($p);
    if ($m === 'km') return ($p['walk'] ?? 0) / 100000;
    if ($m === 'votes') return (float)($ctx['votes']['total'] ?? 0);
    if ($m === 'cq' || $m === 'cqn') { $c = pl_cq()[strtolower($p['uuid'] ?? '')] ?? null; return (float)($c ? ($m === 'cq' ? $c['amount'] : $c['quests']) : 0); }
    return (float)($p[$m] ?? 0);
}
/** Spočítá odznaky hráče. $ctx: team, sponsor, votes, pun, tier, tops (pole uuid -> [rich, topplay, ...]) */
function pl_badges(?array $p, array $ctx): array {
    $has = [];
    if (!empty($ctx['team'])) $has[] = 'team';
    if (!empty($ctx['sponsor'])) $has[] = 'sponsor';
    $tier = $ctx['tier'] ?? null;
    if ($tier === 'legend') $has[] = 'plegend';
    if (in_array($tier, ['legend', 'mecenas'], true)) $has[] = 'pmecenas';
    if ($tier) $has[] = 'patron';
    if (!empty($p['first']) && $p['first'] < (time() - 365 * 86400) * 1000) $has[] = 'veteran';
    if (!empty($p['first']) && $p['first'] < (time() - 730 * 86400) * 1000) $has[] = 'veteran2';
    foreach (BADGE_GOALS as $id => [$m, $need]) if (pl_metric($p, $m, $ctx) >= $need) $has[] = $id;
    $k = (float)($p['kills'] ?? 0);
    if ($k >= 50 && $k / max(1, (float)($p['deaths'] ?? 0)) >= 3) $has[] = 'kd3';
    if (isset($ctx['pun']) && pl_hours($p ?? []) >= 20 && ($ctx['pun']['total'] ?? 1) === 0) $has[] = 'clean';
    foreach ($ctx['tops'] ?? [] as $id) $has[] = $id;
    if (pl_hours($p ?? []) >= 100 && ($p['quests'] ?? 0) >= 100 && ($p['mobs'] ?? 0) >= 1000 && ($p['fish'] ?? 0) >= 100) $has[] = 'allround';
    if (count($has) >= 25) $has[] = 'collector';
    return array_values(array_unique($has));
}
function pl_badge_top(array $has, int $n = 3): array {
    usort($has, fn($a, $b) => (BADGE_RANK[BADGES[$b][3]] <=> BADGE_RANK[BADGES[$a][3]]) ?: (array_search($a, array_keys(BADGES)) <=> array_search($b, array_keys(BADGES))));
    return array_map(fn($id) => ['id' => $id, 'icon' => BADGES[$id][2], 'name' => BADGES[$id][0], 'r' => BADGES[$id][3]], array_slice($has, 0, $n));
}
/** TOP 10 odznaky (rich, topplay, topquest, topkill) pro všechny hráče najednou */
function pl_tops(array $all): array {
    $out = [];
    foreach (['rich' => 'money', 'topplay' => 'play', 'topquest' => 'quests', 'topkill' => 'kills'] as $b => $f)
        foreach (pl_top($all, $f) as $r) if (!empty($r['uuid'])) $out[$r['uuid']][] = $b;
    return $out;
}
/** Odznaky jen z dat serveru (bez DB) – pro seznamy hráčů */
function pl_quick_badges(array $p, array $tops, array $team, array $sponsors): array {
    $k = strtolower($p['name']);
    static $tiers = null;
    if ($tiers === null) $tiers = store_load('patrontiers');
    return pl_badges($p, ['team' => isset($team[$k]), 'sponsor' => isset($sponsors[$k]), 'tier' => $tiers[$k] ?? null, 'tops' => $tops[$p['uuid'] ?? ''] ?? []]);
}

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
    static $ctx = null;
    if ($ctx === null) $ctx = [pl_tops(pl_all()), pl_team(), pl_sponsors()];
    $has = pl_quick_badges($p, ...$ctx);
    return ['name' => $p['name'], 'online' => in_array(strtolower($p['name']), $online, true),
            'hours' => round(pl_hours($p), 1), 'first' => $p['first'] ?? null, 'last' => $p['last'] ?? null,
            'bc' => count($has), 'bt' => pl_badge_top($has)];
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
    if ($field === 'badges') {
        $tops = pl_tops($all); $team = pl_team(); $sp = pl_sponsors();
        $rows = [];
        foreach ($all as $p) { $h = pl_quick_badges($p, $tops, $team, $sp); if ($h) $rows[] = [$p, $h]; }
        usort($rows, fn($a, $b) => (count($b[1]) <=> count($a[1])) ?: (array_sum(array_map(fn($i) => BADGE_RANK[BADGES[$i][3]], $b[1])) <=> array_sum(array_map(fn($i) => BADGE_RANK[BADGES[$i][3]], $a[1]))));
        wyl_json(200, ['ok' => true, 'connected' => count($all) > 0, 'top' => array_map(fn($r) => ['name' => $r[0]['name'], 'value' => count($r[1]), 'bt' => pl_badge_top($r[1], 5),
            'online' => in_array(strtolower($r[0]['name']), $online, true)], array_slice($rows, 0, 10))]);
    }
    if (!in_array($field, ['play', 'money', 'kills', 'mobs', 'fish', 'walk', 'quests', 'vyp'], true)) wyl_json(400, ['ok' => false]);
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
$tier = store_load('patrontiers')[$key] ?? null;
$ctx = ['team' => isset($team[$key]), 'sponsor' => isset($sponsors[$key]), 'votes' => $votes, 'pun' => $pun, 'tier' => $tier,
        'tops' => $p ? (pl_tops($all)[$p['uuid'] ?? ''] ?? []) : []];
$has = pl_badges($p, $ctx);
$goals = [];
foreach (BADGE_GOALS as $id => [$m, $need]) $goals[$id] = [round(min(pl_metric($p, $m, $ctx), $need), 1), $need];
$goals['collector'] = [min(count($has), 25), 25];
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
        'quests' => $p['quests'] ?? null, 'qrank' => $p['qrank'] ?? null, 'vyp' => $p['vyp'] ?? null,
        'cq' => (int)round(pl_cq()[strtolower($p['uuid'] ?? '')]['amount'] ?? 0), 'cqn' => pl_cq()[strtolower($p['uuid'] ?? '')]['quests'] ?? 0,
    ] : null,
    'votes' => $votes,
    'team' => $team[$key] ?? null,
    'sponsor' => isset($sponsors[$key]),
    'punishments' => $pun,
    'bio' => $prof['bio'] ?? '',
    'frame' => $frame,
    'frames' => $frames,
    'badges' => array_map(fn($id) => ['id' => $id, 'name' => BADGES[$id][0], 'desc' => BADGES[$id][1], 'icon' => BADGES[$id][2], 'r' => BADGES[$id][3],
        'has' => in_array($id, $has, true), 'p' => $goals[$id] ?? null], array_keys(BADGES)),
    'showcase' => pl_badge_top($has, 5),
    'own' => $own,
]);
