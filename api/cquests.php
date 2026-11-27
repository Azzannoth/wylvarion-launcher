<?php
/* Wylvarion — komunitní questy (plugin CommunityQuests přes WylWeb).
   GET            → aktivní questy, TOP přispěvatelé, poslední dokončené
   GET top=1      → TOP 10 hráčů podle všech příspěvků (Síň slávy) */
require __DIR__ . '/_store.php';
header('Cache-Control: public, max-age=30');

$cur = store_load('cquests');
$hist = store_load('cqhist');

/** součty příspěvků přes všechny instance questů: uuid => [name, amount, quests] */
function cq_totals(array $hist): array {
    $t = [];
    foreach ($hist as $h) foreach ($h['players'] ?? [] as $uuid => $p) {
        if (($p['amount'] ?? 0) <= 0) continue;
        $t[$uuid]['name'] = $p['name'];
        $t[$uuid]['amount'] = ($t[$uuid]['amount'] ?? 0) + $p['amount'];
        $t[$uuid]['quests'] = ($t[$uuid]['quests'] ?? 0) + 1;
    }
    return $t;
}

if (isset($_GET['top'])) {
    $t = cq_totals($hist);
    uasort($t, fn($a, $b) => $b['amount'] <=> $a['amount']);
    wyl_json(200, ['ok' => true, 'connected' => !empty($cur), 'top' => array_map(fn($r) => ['name' => $r['name'], 'value' => (int)round($r['amount']), 'quests' => $r['quests']], array_values(array_slice($t, 0, 10)))]);
}

$active = [];
foreach ($cur['quests'] ?? [] as $q) {
    $pl = array_values($q['players']);
    usort($pl, fn($a, $b) => $b['amount'] <=> $a['amount']);
    $active[] = ['id' => $q['id'], 'name' => $q['name'], 'desc' => $q['desc'], 'end' => $q['end'], 'objectives' => $q['objectives'],
        'count' => count($pl), 'top' => array_slice($pl, 0, 10)];
}
$isCur = function ($h) use ($cur) { foreach ($cur['quests'] ?? [] as $q) if ($q['id'] === $h['id'] && abs($q['end'] - $h['end']) < 21600) return true; return false; };
$past = array_values(array_filter($hist, fn($h) => !$isCur($h)));
usort($past, fn($a, $b) => $b['end'] <=> $a['end']);
$past = array_map(function ($h) {
    $pl = array_values($h['players']); usort($pl, fn($a, $b) => $b['amount'] <=> $a['amount']);
    return ['name' => $h['name'], 'end' => min($h['end'], time()), 'goal' => $h['goal'], 'done' => $h['done'], 'count' => count($pl), 'best' => $pl[0]['name'] ?? null];
}, array_slice($past, 0, 6));
$t = cq_totals($hist);
wyl_json(200, ['ok' => true, 'connected' => !empty($cur), 'updated' => $cur['saved'] ?? null, 'active' => $active, 'past' => $past,
    'stats' => ['players' => count($t), 'total' => (int)round(array_sum(array_column($t, 'amount'))), 'quests' => count($hist)]]);
