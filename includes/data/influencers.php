<?php
// Influencer program – úrovně, podmínky, výhody a seznam tvůrců.
// creators: ['nick' => 'Nick', 'type' => 'youtuber|streamer|creator', 'url' => 'https://…']
return [
    'apply' => 'https://discord.gg/Q7PUz7ARsS',
    'highlight' => ['title' => 'GOD VIP natrvalo', 'text' => 'Každý schválený tvůrce dostane GOD VIP zdarma – a má ho napořád, dokud má rank tvůrce.'],
    'common_req' => [
        'Pravidelně tvoříš obsah ze serveru Wylvarion: reels, klipy, shorts, videa nebo streamy',
        'Adresa play.wylvarion.cz nebo odkaz na náš Discord v popisu či ve videu',
        'Označuješ obsah #wylvarion',
        'Dodržuješ pravidla serveru i platforem, žádný toxický ani zavádějící obsah',
        'Aspoň 1× měsíčně pošleš do tvůrčího kanálu na Discordu odkazy na svůj obsah',
    ],
    'common_perks' => [
        'GOD VIP natrvalo, dokud máš rank tvůrce',
        'Vlastní rank tvůrce ve hře i na Discordu',
        'Tvůj profil v sekci Naši tvůrci na webu',
        'Přístup k novinkám a eventům dřív než ostatní',
        'Přímý kontakt s admin teamem a podpora pro tvůj obsah',
    ],
    'tiers' => [
        ['id' => 'youtuber', 'name' => 'YouTuber', 'icon' => '🎬', 'color' => '#ef4444',
         'req' => ['Aspoň 300 odběratelů na YouTube', 'Aspoň 1 delší video ze serveru měsíčně', 'K tomu aspoň 4 shorts nebo klipy ze serveru měsíčně'],
         'perks' => ['GOD VIP natrvalo', 'Rank YouTuber', 'Sdílení tvých videí v novinkách a na Discordu', 'Možnost natáčet nové věci a eventy jako první']],
        ['id' => 'streamer', 'name' => 'Streamer', 'icon' => '📺', 'color' => '#a855f7',
         'req' => ['Aspoň 100 sledujících na Twitchi, Kicku nebo YouTube', 'Aspoň 4 streamy ze serveru měsíčně', 'Z každého streamu aspoň 1 klip nebo reel ze serveru'],
         'perks' => ['GOD VIP natrvalo', 'Rank Streamer', 'Oznámení tvých živých streamů na našem Discordu', 'Možnost dělat eventy pro diváky přímo na serveru']],
        ['id' => 'creator', 'name' => 'Short Form Creator', 'icon' => '🎞️', 'color' => '#22d3ee',
         'req' => ['Aspoň 500 sledujících na TikToku, Instagramu nebo YouTube Shorts', 'Aspoň 8 reels, TikToků nebo shorts ze serveru měsíčně', 'Klipy ze serveru: PvP, dungeony, bossové, stavby, eventy'],
         'perks' => ['GOD VIP natrvalo', 'Rank Creator', 'Sdílení tvých klipů na našich sítích', 'Podklady a záběry od nás pro tvoje videa']],
    ],
    'creators' => [],
];
