<?php
/* Wylvarion — banlist s vyhledáváním a stránkováním (LiteBans).
   GET type=BAN|MUTE|KICK|WARN, q=nick (volitelné), page=1..
   IP adresy se nikdy nevrací. */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=30');
require __DIR__ . '/config.php';

const PER_PAGE = 25;
$p = LITEBANS_PREFIX;
$tables = ['BAN' => 'bans', 'MUTE' => 'mutes', 'KICK' => 'kicks', 'WARN' => 'warnings'];
$type = strtoupper($_GET['type'] ?? 'BAN');
if (!isset($tables[$type])) $type = 'BAN';
$q = trim((string)($_GET['q'] ?? ''));
$q = mb_substr(preg_replace('/[^A-Za-z0-9_\-]/', '', $q), 0, 36);
$page = max(1, min(1000, (int)($_GET['page'] ?? 1)));

function wyl_status(array $r, string $type): array {
    $until = (int)$r['until'];
    if ($type === 'KICK') return ['Jednorázový', 'kick'];
    if (!empty($r['removed_by_name']) && (int)$r['active'] === 0) return ['Zrušen', 'removed'];
    if ((int)$r['active'] === 1 && ($until <= 0 || $until / 1000 > time())) return ['Aktivní', 'active'];
    return ['Vypršel', 'expired'];
}

try {
    $pdo = get_db();
    $hidden = require __DIR__ . '/_hidden_players.php';
    $where = "LOWER(TRIM(t.reason)) <> 'test'";
    $args = [];
    if ($hidden) {
        $where .= " AND t.uuid NOT IN (SELECT h2.uuid FROM {$p}history h2 WHERE h2.name IN (" . implode(',', array_fill(0, count($hidden), '?')) . "))";
        $args = array_merge($args, $hidden);
    }
    if ($q !== '') {
        if (preg_match('/^[0-9a-f\-]{32,36}$/i', $q)) {
            $where .= " AND REPLACE(t.uuid,'-','') = ?";
            $args[] = strtolower(str_replace('-', '', $q));
        } else {
            $where .= " AND t.uuid IN (SELECT h.uuid FROM {$p}history h WHERE h.name LIKE ?)";
            $args[] = $q . '%';
        }
    }

    $counts = [];
    foreach ($tables as $k => $tbl) {
        $st = $pdo->prepare("SELECT COUNT(*) FROM {$p}{$tbl} t WHERE $where");
        $st->execute($args);
        $counts[$k] = (int)$st->fetchColumn();
    }

    $tbl = $tables[$type];
    $offset = ($page - 1) * PER_PAGE;
    $untilCol = $type === 'KICK' ? '0' : 't.until';
    $removed = $type === 'KICK' ? "NULL AS removed_by_name, NULL AS removed_by_reason, NULL AS removed_by_date"
                                : "t.removed_by_name, t.removed_by_reason, t.removed_by_date";
    $sql = "SELECT t.id, t.uuid, t.reason, t.banned_by_name, t.time, $untilCol AS until, t.active, $removed,
              (SELECT h.name FROM {$p}history h WHERE h.uuid = t.uuid ORDER BY h.date DESC LIMIT 1) AS nick
            FROM {$p}{$tbl} t WHERE $where ORDER BY t.time DESC LIMIT " . PER_PAGE . " OFFSET $offset";
    $st = $pdo->prepare($sql);
    $st->execute($args);

    $rows = [];
    foreach ($st->fetchAll() as $r) {
        [$label, $style] = wyl_status($r, $type);
        $until = (int)$r['until'];
        $rows[] = [
            'id' => (int)$r['id'],
            'type' => $type,
            'uuid' => $r['uuid'],
            'nick' => $r['nick'],
            'reason' => $r['reason'] ?: 'Bez důvodu',
            'by' => $r['banned_by_name'] ?: 'Console',
            'time' => (int)$r['time'],
            'until' => $type === 'KICK' ? null : ($until <= 0 ? -1 : $until),
            'removed_by' => $r['removed_by_name'] ?: null,
            'status' => $label,
            'style' => $style,
        ];
    }

    echo json_encode([
        'type' => $type, 'q' => $q, 'page' => $page,
        'pages' => max(1, (int)ceil($counts[$type] / PER_PAGE)),
        'counts' => $counts, 'rows' => $rows,
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Databáze trestů teď neodpovídá.']);
}
