package cz.wylvarion.vypravy;

import me.clip.placeholderapi.PlaceholderAPI;
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.OfflinePlayer;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.enchantment.EnchantItemEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityBreedEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.inventory.FurnaceExtractEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Výpravy Prastarých – 100 prémiových časovaných questů, odemčených po 1000 splněných questech QuestCore.
 * Nesplněná výprava v čase se vynuluje a hráč může začít znovu.
 */
public final class WylVypravy extends JavaPlugin implements Listener {

    enum Action { BREAK_BLOCK, KILL_MOB, FISH, HARVEST, CRAFT, SMELT, BREED, ENCHANT }

    record Quest(String id, String name, int level, Action action, Set<String> targets, int amount,
                 String text, Material icon, int timeMinutes, int gems, int money) {
        boolean matches(String target) { return targets.contains("ANY") || targets.contains(target); }
    }

    /** Stav hráče. */
    static final class Data {
        final Set<String> completed = new LinkedHashSet<>();
        String active;          // id aktivní výpravy
        int progress;
        long remaining;         // zbývající sekundy (time-online-only)
        long deadline;          // epoch ms (když čas běží i offline)
        int fails;
        boolean allDone;
        boolean unlockedNotified;
        boolean dirty;
    }

    private static final Pattern HEX = Pattern.compile("&#([0-9a-fA-F]{6})");
    private static final int PER_PAGE = 28;
    private static final int[] QUEST_SLOTS;
    static {
        QUEST_SLOTS = new int[PER_PAGE];
        int i = 0;
        for (int row = 1; row <= 4; row++) for (int col = 1; col <= 7; col++) QUEST_SLOTS[i++] = row * 9 + col;
    }

    private final Map<String, Quest> quests = new LinkedHashMap<>();
    private final Map<UUID, Data> data = new HashMap<>();
    private final Map<UUID, BossBar> bars = new HashMap<>();
    private final Set<Material> trackedPlaced = EnumSet.noneOf(Material.class);
    private NamespacedKey placedKey;
    private File dataDir;

    private int unlockQuests, maxActive;
    private boolean onlineOnly, countSpawner, bossbarOn;

    // =========================================================== start

    @Override
    public void onEnable() {
        placedKey = new NamespacedKey(this, "placed");
        dataDir = new File(getDataFolder(), "data");
        dataDir.mkdirs();
        saveDefaultConfig();
        if (!new File(getDataFolder(), "quests.yml").exists()) saveResource("quests.yml", false);
        loadAll();
        Bukkit.getPluginManager().registerEvents(this, this);
        for (Player p : Bukkit.getOnlinePlayers()) data(p.getUniqueId());
        Bukkit.getScheduler().runTaskTimer(this, this::tick, 20L, 20L);
        Bukkit.getScheduler().runTaskTimerAsynchronously(this, this::saveDirty, 600L, 600L);
        new Expansion().register();
        getLogger().info("Výpravy Prastarých: " + quests.size() + " výprav.");
    }

    @Override
    public void onDisable() {
        for (UUID id : new ArrayList<>(data.keySet())) save(id);
        bars.values().forEach(BossBar::removeAll);
    }

    private void loadAll() {
        reloadConfig();
        var c = getConfig();
        unlockQuests = c.getInt("unlock-quests", 1000);
        maxActive = Math.max(1, c.getInt("max-active", 1));
        onlineOnly = c.getBoolean("time-online-only", true);
        countSpawner = c.getBoolean("count-spawner-mobs", false);
        bossbarOn = c.getBoolean("bossbar", true);

        quests.clear();
        trackedPlaced.clear();
        YamlConfiguration q = YamlConfiguration.loadConfiguration(new File(getDataFolder(), "quests.yml"));
        ConfigurationSection sec = q.getConfigurationSection("quests");
        if (sec == null) return;
        for (String id : sec.getKeys(false)) {
            ConfigurationSection s = sec.getConfigurationSection(id);
            if (s == null) continue;
            Action a;
            try { a = Action.valueOf(s.getString("action", "").toUpperCase(Locale.ROOT)); }
            catch (IllegalArgumentException e) { getLogger().warning("Výprava " + id + ": neznámá akce"); continue; }
            Set<String> targets = new HashSet<>();
            for (String t : s.getString("target", "ANY").split(",")) targets.add(t.trim().toUpperCase(Locale.ROOT));
            Material icon = Material.matchMaterial(s.getString("icon", "PAPER"));
            Quest quest = new Quest(id, s.getString("name", "Výprava " + id), Math.max(1, Math.min(9, s.getInt("level", 1))),
                    a, targets, Math.max(1, s.getInt("amount", 1)), s.getString("text", ""),
                    icon == null || !icon.isItem() ? Material.PAPER : icon,
                    Math.max(1, s.getInt("time-minutes", 60)), s.getInt("gems", 0), s.getInt("money", 0));
            quests.put(id, quest);
            if (a == Action.BREAK_BLOCK || a == Action.HARVEST) for (String t : targets) {
                Material m = Material.matchMaterial(t);
                if (m != null && m.isBlock() && (a == Action.BREAK_BLOCK || m == Material.MELON || m == Material.PUMPKIN)) trackedPlaced.add(m);
            }
        }
    }

    // =========================================================== data

    private Data data(UUID id) {
        return data.computeIfAbsent(id, this::load);
    }

    private Data load(UUID id) {
        Data d = new Data();
        File f = new File(dataDir, id + ".yml");
        if (!f.exists()) return d;
        YamlConfiguration y = YamlConfiguration.loadConfiguration(f);
        d.completed.addAll(y.getStringList("completed"));
        d.active = y.getString("active.id");
        d.progress = y.getInt("active.progress");
        d.remaining = y.getLong("active.remaining");
        d.deadline = y.getLong("active.deadline");
        d.fails = y.getInt("fails");
        d.allDone = y.getBoolean("all-done");
        d.unlockedNotified = y.getBoolean("unlocked-notified");
        if (d.active != null && !quests.containsKey(d.active)) d.active = null;
        return d;
    }

    private void save(UUID id) {
        Data d = data.get(id);
        if (d == null) return;
        YamlConfiguration y = new YamlConfiguration();
        y.set("completed", new ArrayList<>(d.completed));
        if (d.active != null) {
            y.set("active.id", d.active);
            y.set("active.progress", d.progress);
            y.set("active.remaining", d.remaining);
            y.set("active.deadline", d.deadline);
        }
        y.set("fails", d.fails);
        y.set("all-done", d.allDone);
        y.set("unlocked-notified", d.unlockedNotified);
        try { y.save(new File(dataDir, id + ".yml")); d.dirty = false; }
        catch (IOException e) { getLogger().warning("Uložení " + id + " selhalo: " + e.getMessage()); }
    }

    private void saveDirty() {
        Bukkit.getScheduler().runTask(this, () -> {
            for (Map.Entry<UUID, Data> e : data.entrySet()) if (e.getValue().dirty) save(e.getKey());
        });
    }

    private int questCoreCompleted(Player p) {
        String raw = PlaceholderAPI.setPlaceholders(p, getConfig().getString("completed-placeholder", "%questcore_completed%"));
        try { return Integer.parseInt(raw.replaceAll("[^0-9]", "")); } catch (NumberFormatException e) { return 0; }
    }

    private boolean unlocked(Player p) {
        return p.hasPermission("wylvypravy.admin") && p.isOp() || questCoreCompleted(p) >= unlockQuests;
    }

    // =========================================================== texty

    static String color(String s) {
        Matcher m = HEX.matcher(s);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            StringBuilder rep = new StringBuilder("§x");
            for (char ch : m.group(1).toCharArray()) rep.append('§').append(ch);
            m.appendReplacement(sb, Matcher.quoteReplacement(rep.toString()));
        }
        m.appendTail(sb);
        return sb.toString().replaceAll("&([0-9a-fk-orA-FK-OR])", "§$1");
    }

    private void send(Player p, String key, String... kv) {
        String s = getConfig().getString("messages." + key, key);
        for (int i = 0; i + 1 < kv.length; i += 2) s = s.replace(kv[i], kv[i + 1]);
        p.sendMessage(color(getConfig().getString("messages.prefix", "") + s));
    }

    private void sound(Player p, String key) {
        String name = getConfig().getString("sounds." + key);
        if (name != null && !name.isBlank()) p.playSound(p.getLocation(), name, 1f, 1f);
    }

    static String levelColor(int lvl) {
        return switch (lvl) {
            case 1, 2, 3 -> "&#4ADE80";
            case 4, 5, 6 -> "&#FACC15";
            case 7, 8 -> "&#F87171";
            default -> "&#C084FC";
        };
    }

    static String stars(int lvl) {
        StringBuilder sb = new StringBuilder(levelColor(lvl));
        for (int i = 1; i <= 9; i++) {
            if (i == lvl + 1) sb.append("&8");
            sb.append('★');
        }
        return sb.toString();
    }

    static String time(long sec) {
        if (sec < 0) sec = 0;
        long h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60;
        if (h > 0) return h + " h " + m + " min";
        if (m > 0) return m + " min " + s + " s";
        return s + " s";
    }

    static String bar(int done, int total, int width) {
        int full = total <= 0 ? width : (int) Math.round(width * Math.min(1.0, done / (double) total));
        return "&#C084FC" + "▌".repeat(full) + "&8" + "▌".repeat(width - full);
    }

    private long remainingSec(Data d) {
        return onlineOnly ? d.remaining : Math.max(0, (d.deadline - System.currentTimeMillis()) / 1000);
    }

    // =========================================================== menu

    static final class Menu implements InventoryHolder {
        final int page;
        Inventory inv;
        Menu(int page) { this.page = page; }
        @Override public Inventory getInventory() { return inv; }
    }

    private ItemStack item(Material m, String name, List<String> lore, boolean glint) {
        ItemStack it = new ItemStack(m);
        ItemMeta meta = it.getItemMeta();
        meta.setDisplayName(color("&r" + name));
        List<String> l = new ArrayList<>();
        for (String s : lore) l.add(color("&r" + s));
        meta.setLore(l);
        meta.addItemFlags(ItemFlag.values());
        if (glint) meta.setEnchantmentGlintOverride(true);
        it.setItemMeta(meta);
        return it;
    }

    void open(Player p, int page) {
        if (!unlocked(p)) {
            send(p, "locked", "%need%", String.valueOf(unlockQuests), "%have%", String.valueOf(questCoreCompleted(p)));
            return;
        }
        int pages = Math.max(1, (int) Math.ceil(quests.size() / (double) PER_PAGE));
        page = Math.max(0, Math.min(pages - 1, page));
        Menu holder = new Menu(page);
        Inventory inv = Bukkit.createInventory(holder, 54,
                color("&#8B5CF6&l✦ &#C084FC&lVýpravy Prastarých &8(" + (page + 1) + "/" + pages + ")"));
        holder.inv = inv;
        Data d = data(p.getUniqueId());

        ItemStack dark = item(Material.BLACK_STAINED_GLASS_PANE, " ", List.of(), false);
        ItemStack purple = item(Material.PURPLE_STAINED_GLASS_PANE, " ", List.of(), false);
        for (int i = 0; i < 54; i++) {
            int r = i / 9, c = i % 9;
            if (r == 0 || r == 5 || c == 0 || c == 8) inv.setItem(i, ((r + c) % 2 == 0) ? purple : dark);
        }

        int done = d.completed.size(), total = quests.size();
        inv.setItem(4, item(Material.NETHER_STAR, "&#C084FC&l✦ Výpravy Prastarých ✦", List.of(
                "&7Prastaré zkoušky pro ty, kdo splnili",
                "&7přes &f" + unlockQuests + " &7questů.",
                "",
                "&7Splněno: &f" + done + "&7/&f" + total + "  " + bar(done, total, 20),
                "&7Nezdary: &c" + d.fails,
                "",
                "&8Každá výprava má časový limit.",
                "&8Nestihneš ji? Vynuluje se a jedeš znovu."), true));

        List<Quest> list = new ArrayList<>(quests.values());
        for (int i = 0; i < PER_PAGE; i++) {
            int idx = page * PER_PAGE + i;
            if (idx >= list.size()) break;
            inv.setItem(QUEST_SLOTS[i], questItem(list.get(idx), d));
        }

        if (page > 0) inv.setItem(45, item(Material.ARROW, "&#C084FC« Předchozí strana", List.of(), false));
        if (page < pages - 1) inv.setItem(53, item(Material.ARROW, "&#C084FCDalší strana »", List.of(), false));
        inv.setItem(49, item(Material.BARRIER, "&cZavřít", List.of(), false));
        inv.setItem(47, activeItem(d));
        inv.setItem(51, item(Material.KNOWLEDGE_BOOK, "&#FACC15&lJak to funguje", List.of(
                "&7Levým klikem na výpravu ji &apřijmeš&7.",
                "&7Čas běží jen když jsi na serveru.",
                "&7Splň úkol, než čas vyprší.",
                "&7Když nestihneš, postup se vynuluje",
                "&7a můžeš to zkusit znovu.",
                "",
                "&7Úroveň: " + levelColor(1) + "★1-3 &7lehká, " + levelColor(5) + "★4-6 &7střední,",
                levelColor(7) + "★7-8 &7těžká, " + levelColor(9) + "★9 &7legendární",
                "",
                "&8Shift + pravý klik na aktivní výpravu ji zruší."), false));
        p.openInventory(inv);
    }

    private ItemStack activeItem(Data d) {
        Quest q = d.active == null ? null : quests.get(d.active);
        if (q == null) return item(Material.CLOCK, "&7Žádná aktivní výprava", List.of("&8Vyber si výpravu v menu."), false);
        return item(Material.CLOCK, "&#FACC15&lAktivní: &f" + q.name(), List.of(
                "&f" + q.text(),
                "&7Postup: &f" + d.progress + "&7/&f" + q.amount() + "  " + bar(d.progress, q.amount(), 14),
                "&7Zbývá: &e" + time(remainingSec(d))), true);
    }

    private ItemStack questItem(Quest q, Data d) {
        boolean done = d.completed.contains(q.id());
        boolean active = q.id().equals(d.active);
        List<String> lore = new ArrayList<>();
        lore.add("&7Úroveň " + levelColor(q.level()) + q.level() + " &8│ " + stars(q.level()));
        lore.add("");
        lore.add("&f" + q.text());
        lore.add("&7Časový limit: &e" + time(q.timeMinutes() * 60L));
        lore.add("&7Odměna: &#5BC8FF" + q.gems() + " gemů" + (q.money() > 0 ? " &7+ &#E8A23D" + q.money() + " $" : ""));
        lore.add("");
        Material icon = q.icon();
        if (done) {
            lore.add("&a&l✔ Splněno");
        } else if (active) {
            lore.add("&#FACC15&l⏳ Probíhá");
            lore.add("&7Postup: &f" + d.progress + "&7/&f" + q.amount() + "  " + bar(d.progress, q.amount(), 14));
            lore.add("&7Zbývá: &e" + time(remainingSec(d)));
            lore.add("&8Shift + pravý klik = zrušit");
        } else {
            lore.add("&#C084FC▶ Klikni a vydej se na výpravu");
        }
        String name = (done ? "&a" : levelColor(q.level())) + "&l" + q.name() + " &8#" + q.id();
        return item(icon, name, lore, done || active);
    }

    @EventHandler
    public void onClick(InventoryClickEvent e) {
        if (!(e.getView().getTopInventory().getHolder() instanceof Menu menu)) return;
        e.setCancelled(true);
        if (!(e.getWhoClicked() instanceof Player p)) return;
        if (e.getClickedInventory() == null || e.getClickedInventory() != e.getView().getTopInventory()) return;
        int slot = e.getRawSlot();
        if (slot == 45) { open(p, menu.page - 1); return; }
        if (slot == 53) { open(p, menu.page + 1); return; }
        if (slot == 49) { p.closeInventory(); return; }
        for (int i = 0; i < PER_PAGE; i++) {
            if (QUEST_SLOTS[i] != slot) continue;
            int idx = menu.page * PER_PAGE + i;
            List<Quest> list = new ArrayList<>(quests.values());
            if (idx >= list.size()) return;
            Quest q = list.get(idx);
            Data d = data(p.getUniqueId());
            if (q.id().equals(d.active)) {
                if (e.getClick() == ClickType.SHIFT_RIGHT) {
                    d.active = null;
                    d.progress = 0;
                    d.dirty = true;
                    send(p, "cancelled", "%name%", q.name());
                    updateBar(p, d);
                    open(p, menu.page);
                }
                return;
            }
            if (d.completed.contains(q.id())) { send(p, "already-done"); return; }
            if (d.active != null) { send(p, "already-active"); return; }
            start(p, d, q);
            open(p, menu.page);
            return;
        }
    }

    @EventHandler
    public void onDrag(InventoryDragEvent e) {
        if (e.getView().getTopInventory().getHolder() instanceof Menu) e.setCancelled(true);
    }

    private void start(Player p, Data d, Quest q) {
        d.active = q.id();
        d.progress = 0;
        d.remaining = q.timeMinutes() * 60L;
        d.deadline = System.currentTimeMillis() + q.timeMinutes() * 60_000L;
        d.dirty = true;
        send(p, "accepted", "%name%", q.name(), "%time%", time(q.timeMinutes() * 60L));
        sound(p, "accept");
        updateBar(p, d);
    }

    // =========================================================== časovač a bossbar

    private void tick() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            Data d = data(p.getUniqueId());
            if (!d.unlockedNotified && questCoreCompleted(p) >= unlockQuests) {
                d.unlockedNotified = true;
                d.dirty = true;
                send(p, "unlocked-now");
                sound(p, "complete");
            }
            if (d.active == null) { updateBar(p, d); continue; }
            Quest q = quests.get(d.active);
            if (q == null) { d.active = null; continue; }
            if (onlineOnly) { d.remaining--; d.dirty = true; }
            if (remainingSec(d) <= 0) {
                d.active = null;
                d.progress = 0;
                d.fails++;
                d.dirty = true;
                send(p, "failed", "%name%", q.name());
                sound(p, "fail");
                p.sendTitle(color("&c&lČas vypršel"), color("&7" + q.name() + " se vynulovala"), 10, 50, 15);
            }
            updateBar(p, d);
        }
    }

    private void updateBar(Player p, Data d) {
        BossBar b = bars.get(p.getUniqueId());
        Quest q = d.active == null ? null : quests.get(d.active);
        if (!bossbarOn || q == null) {
            if (b != null) { b.removeAll(); bars.remove(p.getUniqueId()); }
            return;
        }
        if (b == null) {
            b = Bukkit.createBossBar("", BarColor.PURPLE, BarStyle.SEGMENTED_10);
            b.addPlayer(p);
            bars.put(p.getUniqueId(), b);
        }
        long rem = remainingSec(d);
        b.setColor(rem < 300 ? BarColor.RED : BarColor.PURPLE);
        b.setTitle(color("&#C084FC✦ &f" + q.name() + " &8│ &f" + d.progress + "&7/&f" + q.amount() + " &8│ &e⏳ " + time(rem)));
        b.setProgress(Math.max(0, Math.min(1, d.progress / (double) q.amount())));
    }

    // =========================================================== postup

    private void add(Player p, Action a, String target, int n) {
        if (n <= 0) return;
        Data d = data.get(p.getUniqueId());
        if (d == null || d.active == null) return;
        Quest q = quests.get(d.active);
        if (q == null || q.action() != a || !q.matches(target)) return;
        int before = d.progress;
        d.progress = Math.min(q.amount(), d.progress + n);
        d.dirty = true;
        if (d.progress >= q.amount()) {
            complete(p, d, q);
            return;
        }
        int step = Math.max(1, q.amount() / 10);
        if (before / step != d.progress / step) sound(p, "progress");
        updateBar(p, d);
    }

    private void complete(Player p, Data d, Quest q) {
        d.completed.add(q.id());
        d.active = null;
        d.progress = 0;
        d.dirty = true;
        String name = p.getName();
        if (q.gems() > 0) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), getConfig().getString("reward-gems-command", "gems give %player% %amount%")
                .replace("%player%", name).replace("%amount%", String.valueOf(q.gems())));
        if (q.money() > 0) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), getConfig().getString("reward-money-command", "eco give %player% %amount%")
                .replace("%player%", name).replace("%amount%", String.valueOf(q.money())));
        send(p, "completed", "%name%", q.name(), "%gems%", String.valueOf(q.gems()));
        sound(p, "complete");
        p.sendTitle(color("&#C084FC&l✦ Výprava splněna ✦"), color("&f" + q.name()), 10, 60, 20);
        if (!d.allDone && d.completed.containsAll(quests.keySet())) {
            d.allDone = true;
            for (String c : getConfig().getStringList("all-done-commands"))
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), color(c.replace("%player%", name)));
        }
        updateBar(p, d);
        save(p.getUniqueId());
    }

    // ---- hráčem položené bloky se nepočítají
    private static long pack(Block b) {
        return ((long) (b.getY() + 2048) << 8) | ((long) (b.getX() & 15) << 4) | (b.getZ() & 15);
    }

    private boolean takePlaced(Block b) {
        PersistentDataContainer pdc = b.getChunk().getPersistentDataContainer();
        long[] arr = pdc.get(placedKey, PersistentDataType.LONG_ARRAY);
        if (arr == null) return false;
        long k = pack(b);
        long[] n = Arrays.stream(arr).filter(v -> v != k).toArray();
        if (n.length == arr.length) return false;
        if (n.length == 0) pdc.remove(placedKey); else pdc.set(placedKey, PersistentDataType.LONG_ARRAY, n);
        return true;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent e) {
        Block b = e.getBlockPlaced();
        if (!trackedPlaced.contains(b.getType())) return;
        PersistentDataContainer pdc = b.getChunk().getPersistentDataContainer();
        long[] arr = pdc.get(placedKey, PersistentDataType.LONG_ARRAY);
        long[] n = arr == null ? new long[1] : Arrays.copyOf(arr, arr.length + 1);
        n[n.length - 1] = pack(b);
        pdc.set(placedKey, PersistentDataType.LONG_ARRAY, n);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent e) {
        Block b = e.getBlock();
        Material m = b.getType();
        boolean placed = trackedPlaced.contains(m) && takePlaced(b);
        Player p = e.getPlayer();
        if (placed) return;
        if (b.getBlockData() instanceof Ageable age) {
            if (age.getAge() >= age.getMaximumAge()) add(p, Action.HARVEST, m.name(), 1);
            return;
        }
        if (m == Material.MELON || m == Material.PUMPKIN) add(p, Action.HARVEST, m.name(), 1);
        add(p, Action.BREAK_BLOCK, m.name(), 1);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onKill(EntityDeathEvent e) {
        LivingEntity ent = e.getEntity();
        Player p = ent.getKiller();
        if (p == null) return;
        if (!countSpawner && ent.getEntitySpawnReason() == CreatureSpawnEvent.SpawnReason.SPAWNER) return;
        add(p, Action.KILL_MOB, ent.getType().name(), 1);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent e) {
        if (e.getState() != PlayerFishEvent.State.CAUGHT_FISH || !(e.getCaught() instanceof Item it)) return;
        add(e.getPlayer(), Action.FISH, it.getItemStack().getType().name(), 1);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraft(CraftItemEvent e) {
        if (!(e.getWhoClicked() instanceof Player p)) return;
        ItemStack result = e.getRecipe().getResult();
        int crafts = 1;
        if (e.isShiftClick()) {
            crafts = Integer.MAX_VALUE;
            for (ItemStack s : e.getInventory().getMatrix()) if (s != null && !s.getType().isAir()) crafts = Math.min(crafts, s.getAmount());
            if (crafts == Integer.MAX_VALUE) crafts = 1;
        }
        add(p, Action.CRAFT, result.getType().name(), result.getAmount() * crafts);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSmelt(FurnaceExtractEvent e) {
        add(e.getPlayer(), Action.SMELT, e.getItemType().name(), e.getItemAmount());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreed(EntityBreedEvent e) {
        if (e.getBreeder() instanceof Player p) add(p, Action.BREED, e.getEntity().getType().name(), 1);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEnchant(EnchantItemEvent e) {
        add(e.getEnchanter(), Action.ENCHANT, e.getItem().getType().name(), 1);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Data d = data(e.getPlayer().getUniqueId());
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (e.getPlayer().isOnline()) updateBar(e.getPlayer(), d);
        }, 40L);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        BossBar b = bars.remove(id);
        if (b != null) b.removeAll();
        save(id);
        data.remove(id);
    }

    // =========================================================== příkaz

    @Override
    public boolean onCommand(CommandSender s, Command cmd, String label, String[] args) {
        if (args.length > 0 && s.hasPermission("wylvypravy.admin")) {
            switch (args[0].toLowerCase(Locale.ROOT)) {
                case "reload" -> {
                    for (UUID id : new ArrayList<>(data.keySet())) save(id);
                    loadAll();
                    s.sendMessage(color("&aVýpravy načteny: " + quests.size()));
                    return true;
                }
                case "reset" -> {
                    if (args.length < 2) { s.sendMessage("/vypravy reset <hráč>"); return true; }
                    OfflinePlayer t = Bukkit.getOfflinePlayer(args[1]);
                    data.remove(t.getUniqueId());
                    new File(dataDir, t.getUniqueId() + ".yml").delete();
                    if (t.getPlayer() != null) data(t.getUniqueId());
                    s.sendMessage(color("&aVýpravy hráče " + args[1] + " vynulovány."));
                    return true;
                }
                case "open" -> {
                    if (args.length >= 2 && Bukkit.getPlayerExact(args[1]) != null) open(Bukkit.getPlayerExact(args[1]), 0);
                    return true;
                }
                default -> { }
            }
        }
        if (!(s instanceof Player p)) { s.sendMessage("Jen pro hráče."); return true; }
        open(p, 0);
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender s, Command cmd, String alias, String[] args) {
        if (args.length == 1 && s.hasPermission("wylvypravy.admin")) return List.of("reload", "reset", "open");
        return List.of();
    }

    // =========================================================== PlaceholderAPI

    private final class Expansion extends PlaceholderExpansion {
        @Override public String getIdentifier() { return "vypravy"; }
        @Override public String getAuthor() { return "Wylvarion"; }
        @Override public String getVersion() { return "1.0.0"; }
        @Override public boolean persist() { return true; }

        @Override
        public String onRequest(OfflinePlayer op, String params) {
            if (op == null) return "";
            Data d = data.get(op.getUniqueId());
            if (d == null) return "";
            Quest q = d.active == null ? null : quests.get(d.active);
            return switch (params) {
                case "completed" -> String.valueOf(d.completed.size());
                case "total" -> String.valueOf(quests.size());
                case "active" -> q == null ? "" : q.name();
                case "active_progress" -> q == null ? "" : d.progress + "/" + q.amount();
                case "active_time" -> q == null ? "" : time(remainingSec(d));
                default -> null;
            };
        }
    }
}
