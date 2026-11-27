<?php
/**
 * creator-code.php — kódy tvůrců obsahu (Influencer program).
 * Hráč při nákupu zadá kód tvůrce (např. MAYO) a tvůrce za nákup dostane gemy do hry.
 * Kódy se nastavují v includes/data/influencers.php u každého tvůrce ('code' => 'MAYO').
 */

// Odměna tvůrci: kolik gemů za každých 100 Kč nákupu (EUR se přepočítá kurzem níže).
const CREATOR_GEMS_PER_100_CZK = 10;
const CREATOR_EUR_TO_CZK = 24.2;
// Příkaz pro připsání gemů (stejný jako u Výprav Prastarých).
const CREATOR_REWARD_CMD = 'gems give {creator} {gems}';

/** Vrátí nick tvůrce pro daný kód, nebo null. */
function creator_code_lookup(string $code): ?string
{
    $code = strtoupper(trim($code));
    if ($code === '' || !preg_match('/^[A-Z0-9_]{2,20}$/', $code)) return null;
    $inf = @include __DIR__ . '/../includes/data/influencers.php';
    foreach ((is_array($inf) ? ($inf['creators'] ?? []) : []) as $c) {
        if (!empty($c['code']) && strtoupper((string)$c['code']) === $code && !empty($c['nick'])) return (string)$c['nick'];
    }
    return null;
}

/** Připíše tvůrci gemy za nákup (volá se z capture-order.php / return.php po doručení). */
function creator_code_reward($rcon, string $code, string $buyer, $amount, string $currency, string $orderId): void
{
    $creator = creator_code_lookup($code);
    if (!$creator || strcasecmp($creator, $buyer) === 0) return;   // vlastní kód se nepočítá
    $czk = $currency === 'EUR' ? (float)$amount * CREATOR_EUR_TO_CZK : (float)$amount;
    $gems = max(1, (int)floor($czk / 100 * CREATOR_GEMS_PER_100_CZK));
    $nick = preg_replace('/[^A-Za-z0-9_]/', '', $creator);
    $rcon->sendCommand(str_replace(['{creator}', '{gems}'], [$nick, $gems], CREATOR_REWARD_CMD));
    usleep(100000);
    $rcon->sendCommand("tellraw {$nick} [{\"text\":\"\\u2764 \",\"color\":\"red\"},{\"text\":\"{$buyer}\",\"color\":\"gold\"},{\"text\":\" nakoupil s tvym kodem tvurce! Dostavas \",\"color\":\"white\"},{\"text\":\"{$gems} gemu\",\"color\":\"light_purple\",\"bold\":true}]");

    @file_put_contents(__DIR__ . '/creator-sales.log', sprintf("[%s] order=%s code=%s creator=%s buyer=%s amount=%s %s gems=%d\n",
        date('Y-m-d H:i:s'), $orderId, strtoupper($code), $nick, $buyer, $amount, $currency, $gems), FILE_APPEND);
    // statistika pro web (žebříček tvůrců)
    try {
        require_once __DIR__ . '/../api/_store.php';
        store_update('creatorsales', function (&$d) use ($nick, $czk, $gems) {
            $m = date('Y-m');
            $d[$m][$nick]['sales'] = ($d[$m][$nick]['sales'] ?? 0) + 1;
            $d[$m][$nick]['gems'] = ($d[$m][$nick]['gems'] ?? 0) + $gems;
        });
    } catch (Throwable $e) { /* jen statistika */ }
}
