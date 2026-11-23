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
    // Resource pack serveru – launcher ho stáhne předem, aby se při připojení nestahoval.
    // Musí to být stejná adresa jako v ItemsAdder/config.yml (pack_hosting.external_host.url).
    'resourcePack' => [
        'url' => 'https://github.com/Azzannoth/ItemsAdderV2/releases/download/1.1/generated.zip',
    ],
    // Seznam modů (přepíše ten vestavěný v launcheru). 'version' připne konkrétní verzi z Modrinthu.
    // Sodium 0.9.3 nefunguje s Iris 1.11.7, proto Sodium 0.9.2 + kompatibilní Sodium Extra a Reese's.
    // Až vyjde Iris pro Sodium 0.9.3+, smaž tři řádky 'version' u sodium, sodium-extra a reeses-sodium-options.
    'mods' => [
        ['id' => 'fabric-api', 'name' => 'Fabric API', 'required' => true],
        ['id' => 'sodium', 'name' => 'Sodium', 'desc' => 'Mnohem vyšší FPS', 'required' => true, 'version' => 'bAZQdGpg'],
        ['id' => 'lithium', 'name' => 'Lithium', 'desc' => 'Optimalizace herní logiky', 'required' => true],
        ['id' => 'ferrite-core', 'name' => 'FerriteCore', 'desc' => 'Nižší spotřeba paměti', 'required' => true],
        ['id' => 'entityculling', 'name' => 'Entity Culling', 'desc' => 'Nevykresluje skryté entity', 'required' => true],
        ['id' => 'immediatelyfast', 'name' => 'ImmediatelyFast', 'desc' => 'Rychlejší vykreslování', 'required' => true],
        ['id' => 'krypton', 'name' => 'Krypton', 'desc' => 'Optimalizace sítě', 'required' => true],
        ['id' => 'simple-voice-chat', 'name' => 'Simple Voice Chat', 'desc' => 'Hlasový chat na serveru', 'required' => true],
        ['id' => 'iris', 'name' => 'Iris Shaders', 'desc' => 'Podpora shaderů', 'required' => true],
        ['id' => 'modmenu', 'name' => 'Mod Menu', 'desc' => 'Seznam a nastavení modů', 'required' => true],
        ['id' => 'xaeros-minimap', 'name' => 'Xaero\'s Minimap', 'desc' => 'Minimapa', 'default' => true],
        ['id' => 'sodium-extra', 'name' => 'Sodium Extra', 'desc' => 'Další grafická nastavení', 'default' => true, 'version' => 'fs5l9Q1U'],
        ['id' => 'reeses-sodium-options', 'name' => 'Reese\'s Sodium Options', 'desc' => 'Přehlednější nastavení grafiky', 'default' => true, 'version' => 'EfchygKx'],
        ['id' => 'continuity', 'name' => 'Continuity', 'desc' => 'Propojené textury skla a bloků', 'default' => true],
        ['id' => 'zoomify', 'name' => 'Zoomify', 'desc' => 'Přiblížení (klávesa C)', 'default' => true],
        ['id' => 'dynamic-fps', 'name' => 'Dynamic FPS', 'desc' => 'Šetří výkon, když hra není v popředí', 'default' => true],
        ['id' => 'fpsdisplay', 'name' => 'FPS Display', 'desc' => 'Zobrazení FPS na obrazovce', 'default' => true],
        ['id' => 'armor-hud', 'name' => 'Armor HUD', 'desc' => 'Výdrž brnění na obrazovce', 'default' => true],
        ['id' => 'reimagined-intro', 'name' => 'Reimagined Intro', 'desc' => 'Animované intro při spuštění hry', 'default' => true],
    ],
    // Po schválení aplikace u Mojangu sem vlož Client ID z Azure (Application (client) ID).
    'microsoft' => [
        'clientId' => '94f67ea2-e7cd-46f1-96fa-86cdafc1c3a4',
    ],
];

echo json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
