<?php
/* Wylvarion — hodnocení členů admin teamu.
   Hodnotit mohou jen členové našeho Discordu (přihlášení přes Discord).
   GET            → souhrn {nick: {avg, count}}
   GET member=X   → recenze člena + stav přihlášení
   POST {member, stars, text}           → uloží / upraví vlastní recenzi
   POST {action:"delete", member}       → smaže vlastní recenzi
   POST {action:"remove", member, id}   → admin webu smaže libovolnou recenzi */
require __DIR__ . '/auth-lib.php';
require_once __DIR__ . '/config.php';
auth_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const RT_FILE = __DIR__ . '/ratings-data.php';
const RT_GUARD = "<?php http_response_code(404); exit; ?>\n";

function rt_load(): array {
    if (!is_file(RT_FILE)) return ['reviews' => [], 'rate' => []];
    $d = json_decode(substr((string)file_get_contents(RT_FILE), strlen(RT_GUARD)), true);
    return is_array($d) ? $d + ['reviews' => [], 'rate' => []] : ['reviews' => [], 'rate' => []];
}
function rt_save(array $d): bool {
    return file_put_contents(RT_FILE, RT_GUARD . json_encode($d, JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}
function rt_members(): array {
    $team = require __DIR__ . '/../includes/data/team.php';
    $out = [];
    foreach ($team as $g) foreach ($g['members'] as $m) {
        if (($m['nick'] ?? '') !== '' && $m['nick'] !== 'Volná pozice') $out[strtolower($m['nick'])] = $m['nick'];
    }
    return $out;
}
function rt_me(): ?array {
    $dc = $_SESSION['discord'] ?? null;
    if (!$dc || empty($dc['id'])) return null;
    $av = (string)($dc['avatar'] ?? '');
    return [
        'id' => (string)$dc['id'],
        'name' => (string)($dc['name'] ?: $dc['username']),
        'avatar' => $av !== '' ? "https://cdn.discordapp.com/avatars/{$dc['id']}/{$av}.png?size=64"
                                : 'https://cdn.discordapp.com/embed/avatars/' . ((int)substr((string)$dc['id'], -3) % 6) . '.png',
        'member' => !empty($dc['member']),
    ];
}
function rt_public(array $r): array {
    return ['id' => $r['id'], 'name' => $r['name'], 'avatar' => $r['avatar'], 'stars' => $r['stars'],
            'text' => $r['text'], 'time' => $r['time'], 'edited' => !empty($r['edited'])];
}

$members = rt_members();
$me = rt_me();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $d = rt_load();
    $key = strtolower((string)($_GET['member'] ?? ''));
    if ($key === '') {
        $sum = [];
        foreach ($members as $k => $nick) {
            $list = $d['reviews'][$k] ?? [];
            $n = count($list);
            $sum[$nick] = ['avg' => $n ? round(array_sum(array_column($list, 'stars')) / $n, 1) : 0, 'count' => $n];
        }
        json_out(200, ['ok' => true, 'summary' => $sum]);
    }
    if (!isset($members[$key])) json_out(404, ['ok' => false, 'error' => 'Tento člen v teamu není.']);
    $list = array_values($d['reviews'][$key] ?? []);
    usort($list, fn($a, $b) => $b['time'] <=> $a['time']);
    $n = count($list);
    $mine = null;
    if ($me) foreach ($list as $r) if ($r['uid'] === $me['id']) $mine = rt_public($r);
    $dist = [5 => 0, 4 => 0, 3 => 0, 2 => 0, 1 => 0];
    foreach ($list as $r) $dist[$r['stars']]++;
    json_out(200, [
        'ok' => true, 'member' => $members[$key],
        'avg' => $n ? round(array_sum(array_column($list, 'stars')) / $n, 1) : 0, 'count' => $n, 'dist' => $dist,
        'reviews' => array_map('rt_public', $list), 'me' => $me, 'mine' => $mine, 'admin' => is_admin(),
    ]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(405, ['ok' => false, 'error' => 'Nepovolená metoda.']);
$in = json_decode((string)file_get_contents('php://input'), true) ?: [];
$key = strtolower((string)($in['member'] ?? ''));
if (!isset($members[$key])) json_out(404, ['ok' => false, 'error' => 'Tento člen v teamu není.']);
$action = (string)($in['action'] ?? 'save');

$fp = fopen(RT_FILE . '.lock', 'c');
flock($fp, LOCK_EX);
$d = rt_load();
$list = $d['reviews'][$key] ?? [];

if ($action === 'remove') {
    if (!is_admin()) json_out(403, ['ok' => false, 'error' => 'Na tohle nemáš oprávnění.']);
    $id = (string)($in['id'] ?? '');
    $d['reviews'][$key] = array_values(array_filter($list, fn($r) => $r['id'] !== $id));
    rt_save($d);
    json_out(200, ['ok' => true]);
}

if (!$me) json_out(401, ['ok' => false, 'error' => 'Nejdřív se přihlas přes Discord.']);
if (!$me['member']) json_out(403, ['ok' => false, 'error' => 'Hodnotit mohou jen členové našeho Discordu.']);

if ($action === 'delete') {
    $d['reviews'][$key] = array_values(array_filter($list, fn($r) => $r['uid'] !== $me['id']));
    rt_save($d);
    json_out(200, ['ok' => true]);
}

$hour = (int)floor(time() / 3600);
$rk = $me['id'] . ':' . $hour;
if (($d['rate'][$rk] ?? 0) >= 10) json_out(429, ['ok' => false, 'error' => 'Moc úprav za krátkou dobu, zkus to prosím za chvíli.']);
$stars = (int)($in['stars'] ?? 0);
if ($stars < 1 || $stars > 5) json_out(400, ['ok' => false, 'error' => 'Vyber počet hvězdiček (1–5).']);
$text = trim(preg_replace('/\s+/u', ' ', strip_tags((string)($in['text'] ?? ''))));
if (mb_strlen($text) < 3) json_out(400, ['ok' => false, 'error' => 'Napiš prosím aspoň pár slov.']);
$text = mb_substr($text, 0, 300);

$found = false;
foreach ($list as &$r) {
    if ($r['uid'] === $me['id']) {
        $r['stars'] = $stars; $r['text'] = $text; $r['name'] = $me['name']; $r['avatar'] = $me['avatar'];
        $r['edited'] = true; $r['time'] = time() * 1000; $found = true;
    }
}
unset($r);
if (!$found) $list[] = ['id' => bin2hex(random_bytes(6)), 'uid' => $me['id'], 'name' => $me['name'], 'avatar' => $me['avatar'],
                        'stars' => $stars, 'text' => $text, 'time' => time() * 1000];
$d['reviews'][$key] = $list;
$d['rate'] = array_filter($d['rate'], fn($k) => (int)explode(':', $k)[1] >= $hour - 1, ARRAY_FILTER_USE_KEY);
$d['rate'][$rk] = ($d['rate'][$rk] ?? 0) + 1;
rt_save($d) ? json_out(200, ['ok' => true]) : json_out(500, ['ok' => false, 'error' => 'Uložení se nepovedlo.']);
