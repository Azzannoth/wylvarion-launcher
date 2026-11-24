<?php
/* Jednoduché úložiště JSON v PHP souborech (stejně jako users.php / news-data.php). */
date_default_timezone_set('Europe/Prague');
const WYL_STORE_GUARD = "<?php http_response_code(404); exit; ?>\n";

function store_path(string $name): string { return __DIR__ . '/data-' . preg_replace('/[^a-z0-9_-]/', '', $name) . '.php'; }
function store_load(string $name, array $default = []): array {
    $f = store_path($name);
    if (!is_file($f)) return $default;
    $d = json_decode(substr((string)file_get_contents($f), strlen(WYL_STORE_GUARD)), true);
    return is_array($d) ? $d + $default : $default;
}
function store_save(string $name, array $data): bool {
    $f = store_path($name);
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (file_put_contents($tmp, WYL_STORE_GUARD . json_encode($data, JSON_UNESCAPED_UNICODE)) === false) return false;
    return rename($tmp, $f);
}
/** Zamkne úložiště, zavolá $fn(data) → nová data, uloží. */
function store_update(string $name, callable $fn, array $default = []) {
    $fp = fopen(store_path($name) . '.lock', 'c');
    flock($fp, LOCK_EX);
    $d = store_load($name, $default);
    $res = $fn($d);
    store_save($name, $d);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $res;
}
function wyl_json(int $code, array $arr): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($arr, JSON_UNESCAPED_UNICODE);
    exit;
}
/** Kdo je přihlášený: web účet / Minecraft / Discord (pro komentáře a reakce). */
function wyl_identity(): ?array {
    auth_start();
    if (!empty($_SESSION['nick'])) {
        return ['key' => 'mc:' . strtolower($_SESSION['nick']), 'name' => $_SESSION['nick'],
                'avatar' => 'https://mc-heads.net/avatar/' . rawurlencode($_SESSION['nick']) . '/64',
                'verified' => !empty($_SESSION['mc_verified']), 'kind' => 'mc'];
    }
    $dc = $_SESSION['discord'] ?? null;
    if ($dc && !empty($dc['id']) && !empty($dc['member'])) {
        $av = (string)($dc['avatar'] ?? '');
        return ['key' => 'dc:' . $dc['id'], 'name' => (string)($dc['name'] ?: $dc['username']),
                'avatar' => $av !== '' ? "https://cdn.discordapp.com/avatars/{$dc['id']}/{$av}.png?size=64" : 'https://cdn.discordapp.com/embed/avatars/0.png',
                'verified' => true, 'kind' => 'dc'];
    }
    return null;
}
function wyl_rate_limit(string $bucket, int $max, int $seconds): bool {
    $key = $bucket . ':' . (int)floor(time() / $seconds);
    return store_update('ratelimit', function (&$d) use ($key, $max, $seconds) {
        $now = (int)floor(time() / $seconds);
        foreach ($d as $k => $v) if ((int)substr($k, strrpos($k, ':') + 1) < $now - 1) unset($d[$k]);
        $d[$key] = ($d[$key] ?? 0) + 1;
        return $d[$key] <= $max;
    });
}

/* Discord role, které smí komentovat a reagovat: Člen (DISCORD_REQUIRED_ROLE_ID) a vyšší. */
const WYL_DC_EXTRA_ROLES = [
    '1556392821039308811', // OWNER
    '1352710333328003092', // ADMIN
    '1556404131579826216', // TECHNIK
    '1556404242955374624', // MODERÁTOR
    '1556404456185397299', // HELPER
    '1546257952602857614', // BUILDER
    '1546256989087207424', // EVENTER
    '1352710110308208703', // Admin Team
    '1536751553602658475', // Streamer
];
/** Přihlášený přes Discord: identita + jestli má roli Člen nebo vyšší. */
function wyl_dc_identity(): ?array {
    auth_start();
    $dc = $_SESSION['discord'] ?? null;
    if (!$dc || empty($dc['id'])) return null;
    $av = (string)($dc['avatar'] ?? '');
    $allowed = !empty($dc['member']) || (bool)array_intersect(WYL_DC_EXTRA_ROLES, $dc['roles'] ?? []);
    return ['key' => 'dc:' . $dc['id'], 'name' => (string)($dc['name'] ?: $dc['username']),
            'avatar' => $av !== '' ? "https://cdn.discordapp.com/avatars/{$dc['id']}/{$av}.png?size=64" : 'https://cdn.discordapp.com/embed/avatars/0.png',
            'allowed' => $allowed, 'reason' => $allowed ? '' : ((string)($dc['reason'] ?? '') ?: 'no_role')];
}
