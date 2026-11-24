<?php
/* Wylvarion — veřejný profil hráče pro banlist.
   GET nick=Jmeno nebo uuid=...  Nevrací IP adresy. */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=30');
require __DIR__ . '/config.php';

$p = LITEBANS_PREFIX;
$nick = preg_replace('/[^A-Za-z0-9_]/', '', (string)($_GET['nick'] ?? ''));
$uuid = strtolower(preg_replace('/[^0-9a-fA-F\-]/', '', (string)($_GET['uuid'] ?? '')));
if ($nick === '' && $uuid === '') { http_response_code(400); echo json_encode(['error' => 'Chybí nick.']); exit; }

try {
    $pdo = get_db();
    if ($uuid === '') {
        $st = $pdo->prepare("SELECT uuid FROM {$p}history WHERE name = ? ORDER BY date DESC LIMIT 1");
        $st->execute([$nick]);
        $uuid = (string)$st->fetchColumn();
    } else {
        $st = $pdo->prepare("SELECT uuid FROM {$p}history WHERE REPLACE(uuid,'-','') = ? ORDER BY date DESC LIMIT 1");
        $st->execute([str_replace('-', '', $uuid)]);
        $uuid = (string)($st->fetchColumn() ?: $uuid);
    }

    $out = ['found' => false, 'nick' => $nick ?: null, 'uuid' => $uuid ?: null];
    if ($uuid !== '') {
        $st = $pdo->prepare("SELECT MIN(date) AS first, MAX(date) AS last FROM {$p}history WHERE uuid = ?");
        $st->execute([$uuid]);
        $h = $st->fetch();
        $st = $pdo->prepare("SELECT name FROM {$p}history WHERE uuid = ? GROUP BY name ORDER BY MAX(date) DESC LIMIT 10");
        $st->execute([$uuid]);
        $names = $st->fetchAll(PDO::FETCH_COLUMN);
        if ($names) {
            $out['found'] = true;
            $out['nick'] = $names[0];
            $out['names'] = $names;
            $out['first_seen'] = $h['first'] ? strtotime($h['first']) * 1000 : null;
            $out['last_seen'] = $h['last'] ? strtotime($h['last']) * 1000 : null;
        }

        $hidden = array_map('strtolower', require __DIR__ . '/_hidden_players.php');
        $hide = (bool)array_intersect($hidden, array_map('strtolower', $names ?? []));
        $list = [];
        $defs = ['BAN' => 'bans', 'MUTE' => 'mutes', 'KICK' => 'kicks', 'WARN' => 'warnings'];
        foreach ($defs as $type => $tbl) {
            $extra = $type === 'KICK' ? "0 AS until, NULL AS removed_by_name" : "t.until, t.removed_by_name";
            $st = $pdo->prepare("SELECT t.reason, t.banned_by_name, t.time, t.active, $extra FROM {$p}{$tbl} t
                                 WHERE t.uuid = ? AND LOWER(TRIM(t.reason)) <> 'test' ORDER BY t.time DESC LIMIT 50");
            $st->execute([$uuid]);
            foreach ($hide ? [] : $st->fetchAll() as $r) {
                $until = (int)$r['until'];
                if ($type === 'KICK') { $s = ['Jednorázový', 'kick']; }
                elseif (!empty($r['removed_by_name']) && (int)$r['active'] === 0) { $s = ['Zrušen', 'removed']; }
                elseif ((int)$r['active'] === 1 && ($until <= 0 || $until / 1000 > time())) { $s = ['Aktivní', 'active']; }
                else { $s = ['Vypršel', 'expired']; }
                $list[] = [
                    'type' => $type, 'reason' => $r['reason'] ?: 'Bez důvodu', 'by' => $r['banned_by_name'] ?: 'Console',
                    'time' => (int)$r['time'], 'until' => $type === 'KICK' ? null : ($until <= 0 ? -1 : $until),
                    'status' => $s[0], 'style' => $s[1],
                ];
            }
        }
        usort($list, fn($a, $b) => $b['time'] <=> $a['time']);
        $out['punishments'] = $list;
        $out['counts'] = array_count_values(array_column($list, 'type')) + ['BAN' => 0, 'MUTE' => 0, 'KICK' => 0, 'WARN' => 0];
        $out['active'] = array_values(array_unique(array_column(array_filter($list, fn($x) => $x['style'] === 'active'), 'type')));
    }

    try {
        $vp = get_db('votes');
        $st = $vp->prepare("SELECT * FROM VotingPlugin_Users WHERE PlayerName = ? LIMIT 1");
        $st->execute([$out['nick'] ?? $nick]);
        if ($v = $st->fetch()) {
            $out['votes'] = [
                'month' => (int)($v['MonthTotal'] ?? 0),
                'total' => (int)($v['AllTimeTotal'] ?? 0),
                'points' => isset($v['Points']) ? (int)$v['Points'] : null,
            ];
            $out['found'] = true;
        }
    } catch (Throwable $e) { /* hlasování je jen doplněk */ }

    echo json_encode($out, JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Databáze teď neodpovídá.']);
}
