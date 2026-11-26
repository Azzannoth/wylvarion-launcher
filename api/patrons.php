<?php
/**
 * api/patrons.php — Patroni Wylvarionu (sekce Sponzoring).
 * Žebříček podle celkové utracené částky, top měsíce, úrovně (1 000+ / 5 000+ / 15 000+),
 * poslední podpora a měsíční cíl serveru. Počítá se ze stejné tabulky orders jako supporters.php.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=60');

require __DIR__ . '/../payment/db.php';

const PT_EUR_TO_CZK = 24.2;
// Měsíční cíl serveru v Kč (provoz, hosting, pluginy). Pro skrytí cíle nastav 0.
const PT_MONTH_GOAL = 10000;
// Úrovně patronů – od nejvyšší.
const PT_TIERS = [
    ['id' => 'legend', 'name' => 'Legenda', 'min' => 15000],
    ['id' => 'mecenas', 'name' => 'Mecenáš', 'min' => 5000],
    ['id' => 'patron', 'name' => 'Patron', 'min' => 1000],
];

function pt_tier(float $czk): ?string {
    foreach (PT_TIERS as $t) {
        if ($czk >= $t['min']) return $t['id'];
    }
    return null;
}

$empty = ['ok' => true, 'connected' => false, 'top' => [], 'month' => [], 'recent' => [],
    'tiers' => PT_TIERS, 'goal' => ['target' => PT_MONTH_GOAL, 'current' => 0], 'stats' => ['patrons' => 0, 'purchases' => 0]];

try {
    db_ensure_table();
    $pdo = db_connect();
    if (!$pdo) { echo json_encode($empty); exit; }

    $sum = "SUM(CASE WHEN currency = 'EUR' THEN amount * :rate ELSE amount END)";

    $st = $pdo->prepare("SELECT nickname, COUNT(*) AS purchases, $sum AS total, MIN(created_at) AS first_at, MAX(created_at) AS last_at
        FROM orders GROUP BY nickname ORDER BY total DESC, purchases DESC LIMIT 100");
    $st->bindValue(':rate', PT_EUR_TO_CZK);
    $st->execute();
    $top = [];
    foreach ($st->fetchAll() as $r) {
        $t = round((float) $r['total']);
        if ($t <= 0) continue;
        $top[] = ['name' => (string) $r['nickname'], 'total' => $t, 'purchases' => (int) $r['purchases'],
            'tier' => pt_tier($t), 'first' => $r['first_at'], 'last' => $r['last_at']];
    }

    $st = $pdo->prepare("SELECT nickname, COUNT(*) AS purchases, $sum AS total FROM orders
        WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00') GROUP BY nickname ORDER BY total DESC LIMIT 10");
    $st->bindValue(':rate', PT_EUR_TO_CZK);
    $st->execute();
    $month = [];
    $monthTotal = 0;
    foreach ($st->fetchAll() as $r) {
        $t = round((float) $r['total']);
        if ($t <= 0) continue;
        $month[] = ['name' => (string) $r['nickname'], 'total' => $t, 'purchases' => (int) $r['purchases']];
    }

    $st = $pdo->prepare("SELECT $sum AS total, COUNT(*) AS n FROM orders WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')");
    $st->bindValue(':rate', PT_EUR_TO_CZK);
    $st->execute();
    $m = $st->fetch();
    $monthTotal = round((float) ($m['total'] ?? 0));

    $recent = [];
    foreach ($pdo->query("SELECT nickname, item_label, created_at FROM orders ORDER BY created_at DESC LIMIT 8")->fetchAll() as $r) {
        $recent[] = ['name' => (string) $r['nickname'], 'item' => (string) $r['item_label'], 'at' => $r['created_at']];
    }

    $stats = $pdo->query("SELECT COUNT(DISTINCT nickname) AS patrons, COUNT(*) AS purchases FROM orders")->fetch();

    echo json_encode([
        'ok' => true,
        'connected' => true,
        'top' => $top,
        'month' => $month,
        'recent' => $recent,
        'tiers' => PT_TIERS,
        'goal' => ['target' => PT_MONTH_GOAL, 'current' => $monthTotal, 'purchases' => (int) ($m['n'] ?? 0)],
        'stats' => ['patrons' => (int) $stats['patrons'], 'purchases' => (int) $stats['purchases']],
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('patrons.php: ' . $e->getMessage());
    echo json_encode($empty);
}
