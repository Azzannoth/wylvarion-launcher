<?php
// Influencer program – úrovně a seznam tvůrců (uprav podle sebe).
// creators: ['nick' => 'Nick', 'type' => 'youtuber|streamer|creator', 'url' => 'https://…']
return [
    'apply' => 'https://discord.gg/Q7PUz7ARsS',
    'tiers' => [
        ['id' => 'youtuber', 'name' => 'YouTuber', 'icon' => '🎬', 'color' => '#ef4444',
         'req' => ['Pravidelně natáčíš videa z Wylvarionu', 'Aspoň 300 odběratelů', 'Odkaz na server v popisu videa'],
         'perks' => ['Rank YouTuber ve hře i na Discordu', 'Sdílení tvých videí v našich novinkách a na Discordu', 'Přímý kontakt s admin teamem']],
        ['id' => 'streamer', 'name' => 'Streamer', 'icon' => '📺', 'color' => '#a855f7',
         'req' => ['Streamuješ Wylvarion na Twitchi, Kicku nebo YouTube', 'Aspoň 100 sledujících', 'Adresa serveru ve streamu nebo v panelu'],
         'perks' => ['Rank Streamer ve hře i na Discordu', 'Oznámení tvých streamů na našem Discordu', 'Přímý kontakt s admin teamem']],
        ['id' => 'creator', 'name' => 'Short Form Creator', 'icon' => '📱', 'color' => '#22d3ee',
         'req' => ['Děláš TikToky, Shorts nebo Reels z Wylvarionu', 'Aspoň 500 sledujících', 'Zmínka o serveru ve videu nebo popisku'],
         'perks' => ['Rank Creator ve hře i na Discordu', 'Sdílení tvých videí na našich sítích', 'Přímý kontakt s admin teamem']],
    ],
    'creators' => [],
];
