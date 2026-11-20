<?php
// Konfigurace a novinky pro Wylvarion Launcher (čte ji launcher při startu).
// Cokoliv tady změníš, launcher převezme bez nové verze (mody, server, odkazy, novinky).
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=120');

$root = dirname(__DIR__);
$news = [];
$file = $root . '/includes/data/news.php';
if (is_file($file)) {
    $items = require $file;
    foreach (array_slice(is_array($items) ? $items : [], 0, 8) as $n) {
        $url = 'https://wylvarion.cz/';
        if (!empty($n['go']['wiki'])) $url .= '#wiki/' . rawurlencode($n['go']['wiki']);
        elseif (!empty($n['go']['panel'])) $url .= '#' . rawurlencode($n['go']['panel']);
        $news[] = [
            'date'  => (string)($n['date'] ?? ''),
            'title' => (string)($n['title'] ?? ''),
            'text'  => (string)($n['desc'] ?? ''),
            'url'   => $url,
        ];
    }
}

$config = [
    'news' => $news,
    // Po schválení aplikace u Mojangu sem vlož Client ID z Azure (Application (client) ID).
    'microsoft' => [
        'clientId' => '94f67ea2-e7cd-46f1-96fa-86cdafc1c3a4',
    ],
];

echo json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
