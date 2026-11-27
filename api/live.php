<?php
/* Wylvarion — kdo z tvůrců (Influencer) právě streamuje.
   GET            → {live:[…], creators:{nick:{…}}, month:{nick:minuty}, best:{…}}
   Stav se zjišťuje nejvýš jednou za 90 s (Twitch přes decapi.me, Kick přes jeho veřejné API)
   a zároveň se počítají minuty, které tvůrce streamoval Wylvarion (žebříček tvůrců). */
require __DIR__ . '/_store.php';
header('Cache-Control: public, max-age=30');

const LIVE_TTL = 90;

function lv_creators(): array {
    $inf = @include __DIR__ . '/../includes/data/influencers.php';
    $out = [];
    foreach ((is_array($inf) ? ($inf['creators'] ?? []) : []) as $c) {
        $nick = (string)($c['nick'] ?? '');
        if ($nick === '') continue;
        $ch = [];
        $links = $c['links'] ?? [];
        if (!$links && !empty($c['url'])) $links = [['name' => 'Kanál', 'url' => $c['url']]];
        foreach ($links as $l) {
            $u = (string)($l['url'] ?? '');
            if (preg_match('~twitch\.tv/([A-Za-z0-9_]{3,25})~i', $u, $m)) $ch[] = ['p' => 'twitch', 'u' => strtolower($m[1])];
            elseif (preg_match('~kick\.com/([A-Za-z0-9_-]{3,30})~i', $u, $m)) $ch[] = ['p' => 'kick', 'u' => strtolower($m[1])];
        }
        $out[$nick] = $ch;
    }
    return $out;
}
function lv_get(string $url, int $timeout = 4): ?string {
    $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'ignore_errors' => true,
        'header' => "User-Agent: Mozilla/5.0 (Wylvarion web; +https://wylvarion.cz)\r\nAccept: application/json, text/plain\r\n"]]);
    $r = @file_get_contents($url, false, $ctx);
    return $r === false ? null : trim($r);
}
function lv_check(array $ch): ?array {
    if ($ch['p'] === 'twitch') {
        $up = lv_get('https://decapi.me/twitch/uptime/' . rawurlencode($ch['u']));
        if ($up === null || $up === '' || stripos($up, 'offline') !== false || stripos($up, 'not found') !== false || stripos($up, 'error') !== false) return null;
        $title = (string)lv_get('https://decapi.me/twitch/title/' . rawurlencode($ch['u']));
        $game = (string)lv_get('https://decapi.me/twitch/game/' . rawurlencode($ch['u']));
        return ['platform' => 'twitch', 'channel' => $ch['u'], 'url' => 'https://www.twitch.tv/' . $ch['u'], 'title' => mb_substr($title, 0, 140), 'game' => mb_substr($game, 0, 60)];
    }
    if ($ch['p'] === 'kick') {
        $j = json_decode((string)lv_get('https://kick.com/api/v2/channels/' . rawurlencode($ch['u'])), true);
        $ls = is_array($j) ? ($j['livestream'] ?? null) : null;
        if (!$ls || empty($ls['is_live'])) return null;
        return ['platform' => 'kick', 'channel' => $ch['u'], 'url' => 'https://kick.com/' . $ch['u'],
            'title' => mb_substr((string)($ls['session_title'] ?? ''), 0, 140), 'game' => mb_substr((string)($ls['categories'][0]['name'] ?? ''), 0, 60)];
    }
    return null;
}
/** Streamuje Wylvarion? (název streamu obsahuje Wylvarion, nebo hraje Minecraft) */
function lv_is_wyl(array $s): bool {
    return stripos($s['title'], 'wylvarion') !== false || stripos($s['game'], 'minecraft') !== false;
}

if (isset($_GET['probe'])) {   // diagnostika: syrová odpověď decapi pro jeden kanál
    $u = preg_replace('/[^A-Za-z0-9_]/', '', (string)$_GET['probe']);
    if (!wyl_rate_limit('liveprobe', 20, 600)) wyl_json(429, ['ok' => false]);
    wyl_json(200, ['ok' => true, 'uptime' => lv_get('https://decapi.me/twitch/uptime/' . $u), 'game' => lv_get('https://decapi.me/twitch/game/' . $u)]);
}

$state = store_load('live');
if (($state['at'] ?? 0) < time() - LIVE_TTL) {
    // jen jeden požadavek najednou kontroluje streamy, ostatní dostanou poslední stav
    $fp = fopen(store_path('live') . '.check', 'c');
    if ($fp && flock($fp, LOCK_EX | LOCK_NB)) {
        $state = store_load('live');
        if (($state['at'] ?? 0) < time() - LIVE_TTL) {
            $now = time();
            $prev = $state['creators'] ?? [];
            $cur = [];
            foreach (lv_creators() as $nick => $chs) {
                $found = null;
                foreach ($chs as $ch) { $found = lv_check($ch); if ($found) break; }
                if ($found) {
                    $found['wyl'] = lv_is_wyl($found);
                    $found['since'] = !empty($prev[$nick]['live']) ? ($prev[$nick]['since'] ?? $now) : $now;
                    $cur[$nick] = ['live' => true] + $found;
                } else {
                    $cur[$nick] = ['live' => false];
                }
            }
            // minuty streamování Wylvarionu (pro žebříček tvůrců)
            $elapsed = min(300, max(0, $now - (int)($state['at'] ?? $now)));
            if ($elapsed > 0) {
                store_update('livestats', function (&$d) use ($cur, $elapsed) {
                    $m = date('Y-m');
                    foreach ($cur as $nick => $s) if (!empty($s['live']) && !empty($s['wyl'])) $d[$m][$nick] = round(($d[$m][$nick] ?? 0) + $elapsed / 60, 1);
                });
            }
            $state = ['at' => $now, 'creators' => $cur];
            store_save('live', $state);
        }
        flock($fp, LOCK_UN);
    }
    if ($fp) fclose($fp);
}

$stats = store_load('livestats');
$m = date('Y-m');
$pm = date('Y-m', strtotime('first day of last month'));
$month = $stats[$m] ?? [];
arsort($month);
$prev = $stats[$pm] ?? [];
arsort($prev);
$live = [];
foreach ($state['creators'] ?? [] as $nick => $s) if (!empty($s['live'])) $live[] = ['nick' => $nick] + $s;
usort($live, fn($a, $b) => ($b['wyl'] <=> $a['wyl']) ?: ($a['since'] <=> $b['since']));

wyl_json(200, ['ok' => true, 'at' => $state['at'] ?? null, 'live' => $live, 'creators' => $state['creators'] ?? (object)[],
    'month' => (object)$month, 'best' => $prev ? ['month' => $pm, 'nick' => array_key_first($prev), 'minutes' => reset($prev)] : null]);
