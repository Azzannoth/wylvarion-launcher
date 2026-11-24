<?php
/* Wylvarion — žádost o spolupráci (rank tvůrce: YouTuber / Streamer / Short Form Creator).
   Odeslat může každý, kdo je na našem Discordu – role Člen není potřeba (stačí i neověřený).
   GET  → stav přihlášení přes Discord;  POST → odešle žádost do Discordu. */
require_once __DIR__ . '/auth-lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    auth_start();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    $dc = $_SESSION['discord'] ?? null;
    $inGuild = $dc && (!empty($dc['member']) || in_array($dc['reason'] ?? '', ['no_role', 'too_new'], true));
    echo json_encode(['ok' => true, 'logged' => (bool)$dc, 'inGuild' => $inGuild, 'name' => $dc ? ($dc['name'] ?: $dc['username']) : null], JSON_UNESCAPED_UNICODE);
    exit;
}

require_once __DIR__ . '/_discord_relay.php';
relay_discord(defined('DISCORD_WEBHOOK_SPOLUPRACE') ? 'DISCORD_WEBHOOK_SPOLUPRACE' : 'DISCORD_WEBHOOK_NABOR', '🎬 Žádost o spolupráci (tvůrce obsahu)', 0xa855f7, [
    'nick'      => 'Minecraft nick',
    'discord'   => 'Discord',
    'typ'       => 'Typ tvůrce',
    'kanal'     => 'Kanál / profil',
    'sledujici' => 'Počet sledujících',
    'obsah'     => 'Obsah ze serveru (odkazy)',
    'plan'      => 'Co plánuje tvořit',
], 'guild');
