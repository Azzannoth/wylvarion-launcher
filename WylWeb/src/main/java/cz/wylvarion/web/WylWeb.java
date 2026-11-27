package cz.wylvarion.web;

import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.java.JavaPlugin;

import javax.crypto.Cipher;
import java.io.File;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WylWeb – propojení serveru s webem wylvarion.cz.
 *  - posílá statistiky hráčů (odehraný čas, peníze, zabití, úmrtí…) pro profily a Síň slávy,
 *  - /web kod  → jednorázový kód pro přihlášení na web,
 *  - ověřuje heslo z AuthMe pro přihlášení na web (heslo chodí zašifrované veřejným klíčem pluginu).
 */
public class WylWeb extends JavaPlugin implements Listener, CommandExecutor {
    private HttpClient http;
    private String url;
    private String secret;
    private PrivateKey privateKey;
    private String publicPem;
    private Object economy;
    private Method balanceMethod;
    private final Map<UUID, Long> codeCooldown = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private volatile boolean polling = false;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        url = getConfig().getString("url", "https://wylvarion.cz/api/mc-sync.php");
        secret = getConfig().getString("secret", "");
        if (secret == null || secret.length() < 24) {
            getLogger().warning("V config.yml chybí 'secret' (stejný jako na webu). Propojení s webem je vypnuté.");
            return;
        }
        http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        try {
            loadKeys();
        } catch (Exception e) {
            getLogger().warning("Nepodařilo se připravit šifrovací klíče: " + e);
        }
        setupEconomy();
        Bukkit.getPluginManager().registerEvents(this, this);
        if (getCommand("web") != null) getCommand("web").setExecutor(this);

        int interval = Math.max(60, getConfig().getInt("interval-seconds", 300));
        int poll = Math.max(2, getConfig().getInt("poll-seconds", 3));
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> post("pubkey", "{\"key\":" + q(publicPem) + "}"));
        Bukkit.getScheduler().runTaskLater(this, this::fullSync, 20L * 60);
        Bukkit.getScheduler().runTaskTimer(this, this::onlineSync, 20L * 90, 20L * interval);
        Bukkit.getScheduler().runTaskTimer(this, this::fullSync, 20L * 60 * 60 * 6, 20L * 60 * 60 * 6);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::pollLogins, 20L * 10, 20L * poll);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::communityQuests, 20L * 30, 20L * 180);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::questFileSync, 20L * 45, 20L * 60 * 30);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::liveCheck, 20L * 20, 20L * 120);
        getLogger().info("WylWeb zapnutý, web: " + url);
    }

    @Override
    public void onDisable() {
        if (http == null) return;
        try {
            List<String> rows = new ArrayList<>();
            for (Player p : Bukkit.getOnlinePlayers()) rows.add(stats(p, false));
            sendStats(rows, true, List.of());
        } catch (Throwable ignored) { }
    }

    // ---------- Statistiky ----------
    private void setupEconomy() {
        try {
            Class<?> eco = Class.forName("net.milkbowl.vault.economy.Economy");
            @SuppressWarnings({"unchecked", "rawtypes"})
            RegisteredServiceProvider<?> rsp = Bukkit.getServicesManager().getRegistration((Class) eco);
            if (rsp != null) {
                economy = rsp.getProvider();
                balanceMethod = eco.getMethod("getBalance", OfflinePlayer.class);
            }
        } catch (Throwable e) {
            economy = null;
        }
    }

    private Double balance(OfflinePlayer p) {
        if (economy == null) return null;
        try {
            Object v = balanceMethod.invoke(economy, p);
            return v instanceof Number ? ((Number) v).doubleValue() : null;
        } catch (Throwable e) {
            return null;
        }
    }

    private int stat(OfflinePlayer p, Statistic s) {
        try {
            return p.getStatistic(s);
        } catch (Throwable e) {
            return -1;
        }
    }

    private String stats(OfflinePlayer p, boolean online) {
        StringBuilder b = new StringBuilder("{");
        b.append("\"uuid\":").append(q(p.getUniqueId().toString()));
        b.append(",\"name\":").append(q(p.getName()));
        b.append(",\"first\":").append(p.getFirstPlayed());
        long last = online ? System.currentTimeMillis() : Math.max(p.getLastPlayed(), safeLastSeen(p));
        b.append(",\"last\":").append(last);
        b.append(",\"online\":").append(online);
        b.append(",\"play\":").append(stat(p, Statistic.PLAY_ONE_MINUTE));
        b.append(",\"kills\":").append(stat(p, Statistic.PLAYER_KILLS));
        b.append(",\"deaths\":").append(stat(p, Statistic.DEATHS));
        b.append(",\"mobs\":").append(stat(p, Statistic.MOB_KILLS));
        b.append(",\"fish\":").append(stat(p, Statistic.FISH_CAUGHT));
        b.append(",\"walk\":").append(stat(p, Statistic.WALK_ONE_CM));
        Double money = balance(p);
        if (money != null) b.append(",\"money\":").append(Math.round(money * 100) / 100.0);
        if (online && Bukkit.getPluginManager().isPluginEnabled("PlaceholderAPI")) papiStats(p, b); // offline hráče řeší questFileSync
        return b.append("}").toString();
    }

    /** Questy (QuestCore) a Výpravy Prastarých přes PlaceholderAPI – jen co jde zjistit. */
    private boolean papiWarned;

    private void papiStats(OfflinePlayer p, StringBuilder b) {
        try {
            int quests = papiInt(p, "%questcore_completed%");
            if (quests >= 0) b.append(",\"quests\":").append(quests);
            String rank = me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(p, "%questcore_rank_key%").trim().toLowerCase(java.util.Locale.ROOT);
            if (rank.matches("[a-z_]{2,20}")) b.append(",\"qrank\":").append(q(rank));
            int vyp = papiInt(p, "%vypravy_done_total%");
            if (vyp >= 0) b.append(",\"vyp\":").append(vyp);
        } catch (Throwable e) {
            // placeholdery jsou jen doplněk – chybu vypíšeme jen jednou
            if (!papiWarned) { papiWarned = true; getLogger().warning("Questy pro web nejdou načíst: " + e); }
        }
    }

    private static int papiInt(OfflinePlayer p, String ph) {
        String v = me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(p, ph).trim();
        return v.matches("\\d{1,9}") ? Integer.parseInt(v) : -1;
    }

    private long safeLastSeen(OfflinePlayer p) {
        try {
            return p.getLastSeen();
        } catch (Throwable e) {
            return 0;
        }
    }

    private List<String> onlineNames() {
        List<String> n = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) n.add(p.getName());
        return n;
    }

    /** Online hráči – každých pár minut. */
    private void onlineSync() {
        List<String> rows = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) rows.add(stats(p, true));
        List<String> online = onlineNames();
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> sendStats(rows, false, online));
    }

    /** Všichni hráči, kteří kdy hráli – po startu a každých 6 hodin (po dávkách, ať server necuká). */
    private void fullSync() {
        OfflinePlayer[] all = Bukkit.getOfflinePlayers();
        Set<UUID> onlineIds = new HashSet<>();
        for (Player p : Bukkit.getOnlinePlayers()) onlineIds.add(p.getUniqueId());
        List<String> rows = Collections.synchronizedList(new ArrayList<>());
        final int[] i = {0};
        final org.bukkit.scheduler.BukkitTask[] task = new org.bukkit.scheduler.BukkitTask[1];
        task[0] = Bukkit.getScheduler().runTaskTimer(this, () -> {
            int end = Math.min(all.length, i[0] + 40);
            for (; i[0] < end; i[0]++) {
                OfflinePlayer p = all[i[0]];
                if (p == null || p.getName() == null) continue;
                try {
                    rows.add(stats(p, onlineIds.contains(p.getUniqueId())));
                } catch (Throwable ignored) { }
            }
            if (i[0] >= all.length) {
                task[0].cancel();
                List<String> copy = new ArrayList<>(rows);
                List<String> online = onlineNames();
                Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
                    for (int k = 0; k < copy.size(); k += 250) {
                        sendStats(copy.subList(k, Math.min(copy.size(), k + 250)), false, k == 0 ? online : null);
                    }
                    getLogger().info("Web: odesláno " + copy.size() + " profilů hráčů.");
                });
            }
        }, 1L, 1L);
    }

    private void sendStats(List<String> rows, boolean shutdown, List<String> online) {
        StringBuilder b = new StringBuilder("{\"players\":[").append(String.join(",", rows)).append("]");
        if (online != null) {
            b.append(",\"online\":[");
            for (int k = 0; k < online.size(); k++) b.append(k > 0 ? "," : "").append(q(online.get(k)));
            b.append("]");
        }
        if (shutdown) b.append(",\"shutdown\":true");
        post("stats", b.append("}").toString());
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        String row = stats(p, true);
        List<String> online = onlineNames();
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> sendStats(List.of(row), false, online));
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        Player p = e.getPlayer();
        String row = stats(p, false);
        List<String> online = onlineNames();
        online.remove(p.getName());
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> sendStats(List.of(row), false, online));
    }

    // ---------- Přihlášení na web ----------
    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("Jen pro hráče.");
            return true;
        }
        Player p = (Player) sender;
        long now = System.currentTimeMillis();
        Long last = codeCooldown.get(p.getUniqueId());
        if (last != null && now - last < 30_000) {
            sender.sendMessage("§cNový kód si můžeš vygenerovat za chvíli.");
            return true;
        }
        codeCooldown.put(p.getUniqueId(), now);
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder code = new StringBuilder();
        for (int k = 0; k < 6; k++) code.append(alphabet.charAt(random.nextInt(alphabet.length())));
        String body = "{\"uuid\":" + q(p.getUniqueId().toString()) + ",\"name\":" + q(p.getName()) + ",\"code\":" + q(code.toString()) + "}";
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            boolean ok = post("code", body) != null;
            Bukkit.getScheduler().runTask(this, () -> {
                if (!p.isOnline()) return;
                if (ok) {
                    p.sendMessage("§d§lWylvarion web §7» §fTvůj kód pro přihlášení: §e§l" + code);
                    p.sendMessage("§7Zadej ho na §bwylvarion.cz§7 → Přihlásit → Kódem ve hře. Platí 10 minut.");
                } else {
                    p.sendMessage("§cWeb teď neodpovídá, zkus to prosím za chvíli.");
                }
            });
        });
        return true;
    }

    private void pollLogins() {
        if (polling || privateKey == null) return;
        polling = true;
        try {
            String res = post("poll", "{}");
            if (res == null || res.isBlank()) return;
            for (String line : res.split("\n")) {
                String[] parts = line.trim().split("\t");
                if (parts.length != 3) continue;
                String id = parts[0], name = parts[1];
                boolean ok = false;
                String reason = "";
                try {
                    Cipher c = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding");
                    c.init(Cipher.DECRYPT_MODE, privateKey);
                    String pass = new String(c.doFinal(Base64.getDecoder().decode(parts[2])), StandardCharsets.UTF_8);
                    Class<?> api = Class.forName("fr.xephi.authme.api.v3.AuthMeApi");
                    Object inst = api.getMethod("getInstance").invoke(null);
                    boolean registered = (Boolean) api.getMethod("isRegistered", String.class).invoke(inst, name);
                    if (!registered) reason = "not_registered";
                    else ok = (Boolean) api.getMethod("checkPassword", String.class, String.class).invoke(inst, name, pass);
                    if (registered && !ok) reason = "bad_password";
                } catch (ClassNotFoundException e) {
                    reason = "no_authme";
                } catch (Throwable e) {
                    reason = "error";
                }
                post("result", "{\"id\":" + q(id) + ",\"ok\":" + ok + ",\"reason\":" + q(reason) + "}");
            }
        } finally {
            polling = false;
        }
    }

    private void loadKeys() throws Exception {
        File dir = getDataFolder();
        dir.mkdirs();
        File priv = new File(dir, "web-private.key"), pub = new File(dir, "web-public.key");
        KeyFactory kf = KeyFactory.getInstance("RSA");
        PublicKey publicKey;
        if (priv.exists() && pub.exists()) {
            privateKey = kf.generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(priv.toPath())));
            publicKey = kf.generatePublic(new X509EncodedKeySpec(Files.readAllBytes(pub.toPath())));
        } else {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            KeyPair kp = g.generateKeyPair();
            privateKey = kp.getPrivate();
            publicKey = kp.getPublic();
            Files.write(priv.toPath(), privateKey.getEncoded());
            Files.write(pub.toPath(), publicKey.getEncoded());
        }
        String b64 = Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(publicKey.getEncoded());
        publicPem = "-----BEGIN PUBLIC KEY-----\n" + b64 + "\n-----END PUBLIC KEY-----\n";
    }

    // ---------- HTTP ----------
    private String post(String action, String json) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url + "?action=" + action))
                    .timeout(Duration.ofSeconds(20))
                    .header("Content-Type", "application/json")
                    .header("X-Wyl-Secret", secret)
                    .header("User-Agent", "WylWeb/1.0")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() != 200) {
                if (!"poll".equals(action)) getLogger().warning("Web " + action + ": HTTP " + res.statusCode());
                return null;
            }
            return res.body();
        } catch (Exception e) {
            if (!"poll".equals(action)) getLogger().warning("Web " + action + ": " + e.getMessage());
            return null;
        }
    }


    /** Komunitní questy (plugin CommunityQuests): stav aktivních questů a příspěvky hráčů → web. */
    private long cqLastMod = 0;
    private void communityQuests() {
        try {
            File dir = new File(getDataFolder().getParentFile(), "CommunityQuests");
            File save = new File(dir, "questSave.json");
            if (!save.isFile()) return;
            long mod = save.lastModified();
            if (mod == cqLastMod) return;
            org.bukkit.configuration.file.YamlConfiguration cfg = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(new File(dir, "config.yml"));
            com.google.gson.JsonObject root = com.google.gson.JsonParser.parseString(Files.readString(save.toPath(), StandardCharsets.UTF_8)).getAsJsonObject();
            StringBuilder b = new StringBuilder("{\"saved\":").append(mod / 1000).append(",\"quests\":[");
            boolean firstQ = true;
            for (com.google.gson.JsonElement qe : root.getAsJsonArray("activeQuests")) {
                com.google.gson.JsonObject qo = qe.getAsJsonObject();
                String id = qo.has("id") ? qo.get("id").getAsString() : "?";
                org.bukkit.configuration.ConfigurationSection sec = cfg.getConfigurationSection("Quests." + id);
                String name = strip(sec != null ? sec.getString("displayName", id) : id);
                String desc = strip(sec != null ? sec.getString("description", "") : "");
                if (!firstQ) b.append(','); firstQ = false;
                b.append("{\"id\":").append(q(id)).append(",\"name\":").append(q(name)).append(",\"desc\":").append(q(desc))
                 .append(",\"type\":").append(q(qo.has("type") ? qo.get("type").getAsString() : ""))
                 .append(",\"timeLeft\":").append(qo.has("timeLeft") ? qo.get("timeLeft").getAsLong() : 0)
                 .append(",\"objectives\":[");
                boolean fo = true;
                if (qo.has("objectives")) for (com.google.gson.JsonElement oe : qo.getAsJsonArray("objectives")) {
                    com.google.gson.JsonObject oo = oe.getAsJsonObject();
                    if (!fo) b.append(','); fo = false;
                    String od = oo.has("description") && !oo.get("description").isJsonNull() ? oo.get("description").getAsString() : (oo.has("type") ? oo.get("type").getAsString() : "");
                    b.append("{\"desc\":").append(q(strip(od))).append(",\"goal\":").append(oo.has("goal") ? oo.get("goal").getAsDouble() : 0)
                     .append(",\"done\":").append(oo.has("amountComplete") ? oo.get("amountComplete").getAsDouble() : 0).append('}');
                }
                b.append("],\"players\":[");
                boolean fp = true;
                if (qo.has("playerMap")) for (com.google.gson.JsonElement pe : qo.getAsJsonArray("playerMap")) {
                    com.google.gson.JsonObject po = pe.getAsJsonObject();
                    String uuid = null; double sum = 0;
                    for (Map.Entry<String, com.google.gson.JsonElement> en : po.entrySet()) {
                        if (en.getKey().equals("name")) continue;
                        uuid = en.getKey();
                        try {
                            com.google.gson.JsonObject m = com.google.gson.JsonParser.parseString(en.getValue().getAsString()).getAsJsonObject();
                            for (Map.Entry<String, com.google.gson.JsonElement> v : m.entrySet()) sum += v.getValue().getAsDouble();
                        } catch (Exception ignored) { }
                    }
                    if (uuid == null) continue;
                    String pn = null;
                    try { pn = Bukkit.getOfflinePlayer(UUID.fromString(uuid)).getName(); } catch (Exception ignored) { }
                    if (pn == null && po.has("name")) pn = strip(po.get("name").getAsString());
                    if (!fp) b.append(','); fp = false;
                    b.append("{\"uuid\":").append(q(uuid)).append(",\"name\":").append(q(pn == null ? "?" : pn)).append(",\"amount\":").append(sum).append('}');
                }
                b.append("]}");
            }
            b.append("]}");
            if (post("cquests", b.toString()) != null) cqLastMod = mod;
        } catch (Exception ex) {
            getLogger().warning("CommunityQuests sync: " + ex.getMessage());
        }
    }
    private static String strip(String s) {
        if (s == null) return "";
        return s.replaceAll("(?i)[§&]x([§&][0-9a-f]){6}", "").replaceAll("(?i)[§&][0-9a-fk-or]", "").replaceAll("<[^>]{1,30}>", "").trim();
    }


    /** Questy a výpravy všech hráčů (i offline) přímo ze souborů QuestCore a WylVypravy → web. */
    private void questFileSync() {
        try {
            File plugins = getDataFolder().getParentFile();
            Map<String, int[]> vyp = new HashMap<>();
            File vd = new File(plugins, "WylVypravy/data");
            int perRound = 100;
            File[] vf = vd.listFiles((d, n) -> n.endsWith(".yml"));
            if (vf != null) for (File f : vf) {
                org.bukkit.configuration.file.YamlConfiguration y = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(f);
                int total = (Math.max(1, y.getInt("round", 1)) - 1) * perRound + y.getStringList("completed").size();
                vyp.put(f.getName().replace(".yml", "").toLowerCase(), new int[]{total});
            }
            File qd = new File(plugins, "QuestCore/playerdata");
            File[] qf = qd.listFiles((d, n) -> n.endsWith(".yml"));
            if (qf == null) return;
            StringBuilder b = new StringBuilder("{\"players\":[");
            boolean first = true; int count = 0;
            for (File f : qf) {
                String uuid = f.getName().replace(".yml", "").toLowerCase();
                int completed = 0; String rank = null;
                for (String line : Files.readAllLines(f.toPath(), StandardCharsets.UTF_8)) {
                    if (line.startsWith("completed_quests:")) { try { completed = Integer.parseInt(line.substring(17).trim()); } catch (NumberFormatException ignored) { } }
                    else if (line.startsWith("current_rank:")) rank = line.substring(13).trim().replace("'", "").replace("\"", "");
                }
                int[] v = vyp.get(uuid);
                if (completed <= 0 && v == null) continue;
                if (!first) b.append(','); first = false;
                b.append("{\"uuid\":").append(q(uuid)).append(",\"quests\":").append(completed);
                if (rank != null && rank.matches("[a-z_]{2,20}")) b.append(",\"qrank\":").append(q(rank));
                if (v != null) b.append(",\"vyp\":").append(v[0]);
                b.append('}');
                if (++count % 400 == 0) { b.append("]}"); post("qsync", b.toString()); b = new StringBuilder("{\"players\":["); first = true; }
            }
            b.append("]}");
            if (!first) post("qsync", b.toString());
        } catch (Exception ex) {
            getLogger().warning("Quest sync: " + ex.getMessage());
        }
    }


    /** Tvůrci obsahu: když někdo začne streamovat Wylvarion, oznámí to ve hře. */
    private final Set<String> liveNow = ConcurrentHashMap.newKeySet();
    private boolean liveInit = false;
    private void liveCheck() {
        try {
            String liveUrl = url.replace("mc-sync.php", "live.php");
            HttpRequest req = HttpRequest.newBuilder(URI.create(liveUrl)).timeout(Duration.ofSeconds(20))
                    .header("User-Agent", "WylWeb/1.3").GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() != 200) return;
            com.google.gson.JsonObject root = com.google.gson.JsonParser.parseString(res.body()).getAsJsonObject();
            Set<String> cur = new HashSet<>();
            List<String[]> fresh = new ArrayList<>();
            for (com.google.gson.JsonElement e : root.getAsJsonArray("live")) {
                com.google.gson.JsonObject o = e.getAsJsonObject();
                if (!o.has("wyl") || !o.get("wyl").getAsBoolean()) continue;
                String nick = o.get("nick").getAsString();
                String key = nick + "|" + (o.has("since") ? o.get("since").getAsLong() : 0);
                cur.add(key);
                if (liveInit && !liveNow.contains(key))
                    fresh.add(new String[]{nick, o.get("url").getAsString(), o.has("platform") ? o.get("platform").getAsString() : "twitch"});
            }
            liveNow.clear(); liveNow.addAll(cur); liveInit = true;
            for (String[] f : fresh) {
                String nick = f[0].replaceAll("[^A-Za-z0-9_.]", "");
                String link = f[1].replaceAll("[^A-Za-z0-9_:/.?=&%-]", "");
                String plat = "kick".equals(f[2]) ? "Kicku" : "Twitchi";
                String mm = "<gradient:#ef4444:#a855f7><bold>LIVE</bold></gradient> <white>🎥 " + nick + "</white> <gray>právě streamuje Wylvarion na " + plat + "!</gray> "
                        + "<click:open_url:'" + link + "'><hover:show_text:'<gray>Otevřít stream'><#ef4444><u>Sledovat ▶</u></#ef4444></hover></click>";
                Bukkit.getScheduler().runTask(this, () -> Bukkit.broadcast(net.kyori.adventure.text.minimessage.MiniMessage.miniMessage().deserialize(mm)));
            }
        } catch (Exception ex) {
            // stav streamů je jen doplněk
        }
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
