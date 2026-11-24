<?php
/* Wylvarion — Novinky (blog): články, reakce a komentáře.
   GET                 → seznam článků
   GET id=ID           → článek s komentáři
   POST {action:"react", id, emoji}      (přihlášený přes web/Minecraft nebo Discord)
   POST {action:"comment", id, text}
   POST {action:"delcomment", id, cid}   (autor komentáře nebo správce)
   POST {action:"save", post:{…}}        (správce / eventer)
   POST {action:"delete", id}            (správce) */
require __DIR__ . '/auth-lib.php';
require __DIR__ . '/_store.php';
auth_start();

const EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];

function posts_seed(): array {
    $out = [];
    $news = require __DIR__ . '/../includes/data/news.php';
    $i = 0;
    foreach (array_reverse($news) as $n) {
        $ts = DateTime::createFromFormat('j. n. Y H:i', trim($n['date']) . ' 12:00');
        $id = substr(preg_replace('/[^a-z0-9]+/', '-', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $n['title']))), 0, 48) ?: ('clanek-' . $i);
        $id = trim($id, '-');
        $out[$id] = ['id' => $id, 'title' => $n['title'], 'tag' => $n['tag'], 'color' => $n['color'] ?? '#a855f7', 'icon' => $n['icon'] ?? 'paper',
            'time' => ($ts ? $ts->getTimestamp() : time() - $i * 3600) * 1000 + $i, 'author' => 'Wylvarion Team',
            'excerpt' => $n['desc'], 'body' => $n['desc'], 'go' => $n['go'] ?? null, 'reactions' => [], 'comments' => []];
        $i++;
    }
    return ['posts' => $out];
}
function posts_load(): array {
    $d = store_load('posts');
    if (empty($d['posts'])) { $d = posts_seed(); store_save('posts', $d); }
    return $d;
}
function read_min(string $body): int { return max(1, (int)round(str_word_count(strip_tags($body), 0, 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ') / 200)); }
function post_public(array $p, ?array $me, bool $full): array {
    $react = [];
    foreach (EMOJIS as $e) $react[] = ['emoji' => $e, 'count' => count($p['reactions'][$e] ?? []), 'mine' => $me && in_array($me['key'], $p['reactions'][$e] ?? [], true)];
    $out = ['id' => $p['id'], 'title' => $p['title'], 'tag' => $p['tag'], 'color' => $p['color'], 'icon' => $p['icon'], 'time' => $p['time'],
        'author' => $p['author'], 'excerpt' => $p['excerpt'], 'cover' => $p['cover'] ?? null, 'go' => $p['go'] ?? null, 'readMin' => read_min($p['body']),
        'reactions' => $react, 'commentCount' => count($p['comments'] ?? [])];
    if ($full) {
        $out['body'] = $p['body'];
        $out['comments'] = array_map(fn($c) => ['id' => $c['id'], 'name' => $c['name'], 'avatar' => $c['avatar'], 'text' => $c['text'], 'time' => $c['time'],
            'mine' => $me && $c['key'] === $me['key']], $p['comments'] ?? []);
    }
    return $out;
}

$me = wyl_identity();
$staff = is_event_staff();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $d = posts_load();
    $id = (string)($_GET['id'] ?? '');
    if ($id !== '') {
        $p = $d['posts'][$id] ?? null;
        if (!$p) wyl_json(404, ['ok' => false, 'error' => 'Článek neexistuje.']);
        $list = array_values($d['posts']); usort($list, fn($a, $b) => $b['time'] <=> $a['time']);
        $idx = array_search($id, array_column($list, 'id'), true);
        wyl_json(200, ['ok' => true, 'post' => post_public($p, $me, true), 'me' => $me ? ['name' => $me['name'], 'avatar' => $me['avatar']] : null,
            'staff' => $staff, 'admin' => is_admin(),
            'newer' => $idx > 0 ? ['id' => $list[$idx - 1]['id'], 'title' => $list[$idx - 1]['title']] : null,
            'older' => isset($list[$idx + 1]) ? ['id' => $list[$idx + 1]['id'], 'title' => $list[$idx + 1]['title']] : null]);
    }
    $list = array_values($d['posts']); usort($list, fn($a, $b) => $b['time'] <=> $a['time']);
    wyl_json(200, ['ok' => true, 'posts' => array_map(fn($p) => post_public($p, $me, false), $list), 'staff' => $staff]);
}

$in = json_decode((string)file_get_contents('php://input'), true) ?: [];
$action = (string)($in['action'] ?? '');
$id = (string)($in['id'] ?? '');

if ($action === 'save') {
    if (!$staff) wyl_json(403, ['ok' => false, 'error' => 'Na tohle nemáš oprávnění.']);
    $p = $in['post'] ?? [];
    $title = trim(mb_substr((string)($p['title'] ?? ''), 0, 120));
    $body = trim(mb_substr((string)($p['body'] ?? ''), 0, 20000));
    if ($title === '' || $body === '') wyl_json(400, ['ok' => false, 'error' => 'Vyplň nadpis i text.']);
    $res = store_update('posts', function (&$d) use ($p, $title, $body) {
        if (empty($d['posts'])) $d = posts_seed();
        $id = (string)($p['id'] ?? '');
        if ($id === '' || !isset($d['posts'][$id])) {
            $id = trim(substr(preg_replace('/[^a-z0-9]+/', '-', strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $title))), 0, 48), '-') ?: 'clanek';
            while (isset($d['posts'][$id])) $id .= '-' . random_int(2, 99);
            $d['posts'][$id] = ['id' => $id, 'time' => time() * 1000, 'reactions' => [], 'comments' => [], 'author' => $_SESSION['nick'] ?? 'Wylvarion Team'];
        }
        $excerpt = trim(mb_substr((string)($p['excerpt'] ?? ''), 0, 220));
        if ($excerpt === '') $excerpt = mb_substr(trim(preg_replace('/[#*_>\-\[\]()]/', '', preg_replace('/\s+/', ' ', $body))), 0, 180);
        $d['posts'][$id] = array_merge($d['posts'][$id], [
            'title' => $title, 'body' => $body, 'excerpt' => $excerpt,
            'tag' => trim(mb_substr((string)($p['tag'] ?? 'Novinka'), 0, 24)) ?: 'Novinka',
            'color' => preg_match('/^#[0-9a-f]{6}$/i', (string)($p['color'] ?? '')) ? $p['color'] : '#a855f7',
            'icon' => preg_replace('/[^a-z0-9_]/', '', (string)($p['icon'] ?? 'paper')) ?: 'paper',
            'cover' => preg_match('#^https://#', (string)($p['cover'] ?? '')) ? (string)$p['cover'] : null,
        ]);
        return $id;
    });
    wyl_json(200, ['ok' => true, 'id' => $res]);
}
if ($action === 'delete') {
    if (!is_admin()) wyl_json(403, ['ok' => false, 'error' => 'Na tohle nemáš oprávnění.']);
    store_update('posts', function (&$d) use ($id) { unset($d['posts'][$id]); });
    wyl_json(200, ['ok' => true]);
}

if (!$me) wyl_json(401, ['ok' => false, 'error' => 'Nejdřív se přihlas (Minecraft účtem nebo přes Discord).']);

if ($action === 'react') {
    $emoji = (string)($in['emoji'] ?? '');
    if (!in_array($emoji, EMOJIS, true)) wyl_json(400, ['ok' => false]);
    if (!wyl_rate_limit('react:' . $me['key'], 40, 300)) wyl_json(429, ['ok' => false, 'error' => 'Pomaleji :)']);
    $ok = store_update('posts', function (&$d) use ($id, $emoji, $me) {
        if (!isset($d['posts'][$id])) return false;
        $list = $d['posts'][$id]['reactions'][$emoji] ?? [];
        $list = in_array($me['key'], $list, true) ? array_values(array_diff($list, [$me['key']])) : array_merge($list, [$me['key']]);
        $d['posts'][$id]['reactions'][$emoji] = $list;
        return true;
    });
    $ok ? wyl_json(200, ['ok' => true]) : wyl_json(404, ['ok' => false]);
}
if ($action === 'comment') {
    $text = trim(preg_replace('/[ \t]+/u', ' ', strip_tags((string)($in['text'] ?? ''))));
    $text = mb_substr(preg_replace("/\n{3,}/", "\n\n", $text), 0, 600);
    if (mb_strlen($text) < 2) wyl_json(400, ['ok' => false, 'error' => 'Napiš aspoň pár slov.']);
    if (!wyl_rate_limit('comment:' . $me['key'], 5, 300)) wyl_json(429, ['ok' => false, 'error' => 'Moc komentářů za chvíli, zkus to prosím později.']);
    $ok = store_update('posts', function (&$d) use ($id, $text, $me) {
        if (!isset($d['posts'][$id])) return false;
        $d['posts'][$id]['comments'][] = ['id' => bin2hex(random_bytes(5)), 'key' => $me['key'], 'name' => $me['name'], 'avatar' => $me['avatar'], 'text' => $text, 'time' => time() * 1000];
        return true;
    });
    $ok ? wyl_json(200, ['ok' => true]) : wyl_json(404, ['ok' => false]);
}
if ($action === 'delcomment') {
    $cid = (string)($in['cid'] ?? '');
    $admin = is_admin();
    store_update('posts', function (&$d) use ($id, $cid, $me, $admin) {
        if (!isset($d['posts'][$id])) return;
        $d['posts'][$id]['comments'] = array_values(array_filter($d['posts'][$id]['comments'] ?? [], fn($c) => !($c['id'] === $cid && ($admin || $c['key'] === $me['key']))));
    });
    wyl_json(200, ['ok' => true]);
}
wyl_json(400, ['ok' => false, 'error' => 'Neznámá akce.']);
