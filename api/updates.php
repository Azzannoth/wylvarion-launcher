<?php
/* Wylvarion — Updaty (changelog): každá změna na serveru, webu a v launcheru.
   GET → seznam změn;  POST {action:"add", cat, kind, text} (správce/eventer);  POST {action:"delete", id} (správce).
   Denní souhrn na Discord: když je v config.php DISCORD_WEBHOOK_UPDATES, po 20:00 se pošle souhrn změn za den. */
require __DIR__ . '/auth-lib.php';
require_once __DIR__ . '/config.php';
require __DIR__ . '/_store.php';
auth_start();

const UPD_CATS = ['Server', 'Web', 'Launcher', 'Eventy', 'Discord'];
const UPD_KINDS = ['new' => '✨', 'fix' => '🔧', 'change' => '🔄', 'remove' => '🗑️'];

function upd_seed(): array {
    $t = strtotime('2026-11-24 12:00') * 1000;
    $mk = fn($cat, $kind, $text, $h = 0) => ['id' => bin2hex(random_bytes(5)), 'time' => $t + $h * 60000, 'cat' => $cat, 'kind' => $kind, 'text' => $text];
    return ['items' => [
        $mk('Web', 'new', 'Banlist: vyhledávání podle nicku, stránkování a profil hráče po kliknutí na hlavu', 1),
        $mk('Web', 'new', 'Admin Team: hodnocení členů hvězdičkami (jen pro hráče s rolí Člen na Discordu)', 2),
        $mk('Web', 'change', 'Wiki: vyhledávání v textu článků, filtry kategorií a doba čtení', 3),
        $mk('Web', 'change', 'Banlist ukazuje celý důvod trestu, sprostá slova jsou zakrytá', 4),
        $mk('Launcher', 'fix', 'Bílé okno při přihlášení Microsoft: chybová hláška, Zkusit znovu a přihlášení kódem v prohlížeči (1.1.2)', 5),
        $mk('Launcher', 'new', 'Okno s vysvětlením, proč hra spadla, a opravou jedním kliknutím (1.1.3)', 6),
        $mk('Launcher', 'fix', 'Launcher se schová až po otevření okna Minecraftu, ne hned po spuštění (1.1.3)', 7),
        $mk('Launcher', 'fix', 'macOS: aplikace se už neoznačuje jako poškozená (1.1.4)', 8),
        $mk('Launcher', 'change', 'Intro 6.3.0: logo v bezpečné zóně pro 4K a širokoúhlé monitory', 9),
        $mk('Server', 'fix', 'Změna skinu z launcheru se na serveru projeví do pár minut', 10),
    ]];
}
function upd_load(): array { $d = store_load('updates'); if (!isset($d['items'])) { $d = upd_seed(); store_save('updates', $d); } return $d; }

function upd_discord_summary(): void {
    if (!defined('DISCORD_WEBHOOK_UPDATES') || DISCORD_WEBHOOK_UPDATES === '') return;
    if ((int)date('G') < 20) return;
    $today = date('Y-m-d');
    $send = store_update('updates', function (&$d) use ($today) {
        if (($d['summary_sent'] ?? '') === $today) return null;
        $d['summary_sent'] = $today;
        return array_values(array_filter($d['items'] ?? [], fn($i) => date('Y-m-d', (int)($i['time'] / 1000)) === $today));
    });
    if (!$send) return;
    $lines = [];
    foreach ($send as $i) $lines[] = (UPD_KINDS[$i['kind']] ?? '•') . ' **' . $i['cat'] . ':** ' . $i['text'];
    $payload = ['embeds' => [['title' => '📋 Dnešní změny na Wylvarionu', 'description' => mb_substr(implode("\n", $lines), 0, 3900),
        'color' => 0xa855f7, 'url' => 'https://wylvarion.cz/#updaty', 'footer' => ['text' => date('j. n. Y')]]]];
    $ch = curl_init(DISCORD_WEBHOOK_UPDATES);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
    curl_exec($ch);
    curl_close($ch);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $d = upd_load();
    upd_discord_summary();
    $items = $d['items']; usort($items, fn($a, $b) => $b['time'] <=> $a['time']);
    wyl_json(200, ['ok' => true, 'cats' => UPD_CATS, 'items' => array_slice($items, 0, 600), 'staff' => is_event_staff(), 'admin' => is_admin()]);
}
$in = json_decode((string)file_get_contents('php://input'), true) ?: [];
$action = (string)($in['action'] ?? '');
if ($action === 'add') {
    if (!is_event_staff()) wyl_json(403, ['ok' => false, 'error' => 'Na tohle nemáš oprávnění.']);
    $cat = in_array($in['cat'] ?? '', UPD_CATS, true) ? $in['cat'] : 'Server';
    $kind = isset(UPD_KINDS[$in['kind'] ?? '']) ? $in['kind'] : 'new';
    $text = trim(mb_substr(strip_tags((string)($in['text'] ?? '')), 0, 300));
    if (mb_strlen($text) < 3) wyl_json(400, ['ok' => false, 'error' => 'Napiš, co se změnilo.']);
    store_update('updates', function (&$d) use ($cat, $kind, $text) {
        if (!isset($d['items'])) $d = upd_seed();
        $d['items'][] = ['id' => bin2hex(random_bytes(5)), 'time' => time() * 1000, 'cat' => $cat, 'kind' => $kind, 'text' => $text, 'by' => $_SESSION['nick'] ?? null];
    });
    wyl_json(200, ['ok' => true]);
}
if ($action === 'delete') {
    if (!is_admin()) wyl_json(403, ['ok' => false, 'error' => 'Na tohle nemáš oprávnění.']);
    $id = (string)($in['id'] ?? '');
    store_update('updates', function (&$d) use ($id) { $d['items'] = array_values(array_filter($d['items'] ?? [], fn($i) => $i['id'] !== $id)); });
    wyl_json(200, ['ok' => true]);
}
wyl_json(400, ['ok' => false, 'error' => 'Neznámá akce.']);
