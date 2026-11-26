package cz.wylvarion.drevorubec;

import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.type.Leaves;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockDropItemEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * WylDrevorubec – sekerou pokácí celý PŘIROZENÝ strom.
 * Stavby ze dřeva nekácí: hráčem položené kmeny si pamatuje (PDC chunku) a u stromů
 * vyžaduje přirozené listí (listí položené hráčem je "persistent").
 */
public final class WylDrevorubec extends JavaPlugin implements Listener {

    /** Definice jednoho druhu stromu z configu. */
    private record TreeType(String id, Set<Material> logs, Set<Material> leaves, boolean naturalLeaves,
                            int minLeaves, int maxLogs, int maxRadius, Material sapling) { }

    private static final Pattern HEX = Pattern.compile("&#([0-9a-fA-F]{6})");
    private static final Set<Material> SOIL = EnumSet.of(Material.DIRT, Material.GRASS_BLOCK, Material.PODZOL,
            Material.COARSE_DIRT, Material.ROOTED_DIRT, Material.MOSS_BLOCK, Material.MUD, Material.MYCELIUM);

    private final List<TreeType> trees = new ArrayList<>();
    private final Map<Material, List<TreeType>> byLog = new EnumMap<>(Material.class);
    private final Set<Material> allLogs = EnumSet.noneOf(Material.class);
    private final Set<Material> tools = EnumSet.noneOf(Material.class);
    private final Set<String> disabledWorlds = new HashSet<>();

    /** Hráči, za které právě kácíme (aby se naše vlastní rozbíjení nespouštělo znovu). */
    private final Set<UUID> cutting = new HashSet<>();
    /** Bloky, které kácíme – kvůli itemům do inventáře. */
    private final Map<Location, UUID> cutBlocks = new HashMap<>();

    private NamespacedKey placedKey;
    private NamespacedKey offKey;

    private boolean requireSneak, toInventory, replant, breakLeaves;
    private int perTick;
    private float exhaustion;

    @Override
    public void onEnable() {
        placedKey = new NamespacedKey(this, "placed_logs");
        offKey = new NamespacedKey(this, "off");
        saveDefaultConfig();
        load();
        Bukkit.getPluginManager().registerEvents(this, this);
        getLogger().info("WylDrevorubec zapnutý – " + trees.size() + " druhů stromů.");
    }

    private void load() {
        reloadConfig();
        var c = getConfig();
        requireSneak = c.getBoolean("require-sneak", false);
        perTick = Math.max(0, c.getInt("blocks-per-tick", 3));
        toInventory = c.getBoolean("items-to-inventory", false);
        replant = c.getBoolean("auto-replant", true);
        breakLeaves = c.getBoolean("break-leaves", false);
        exhaustion = (float) c.getDouble("exhaustion-per-log", 0.02);

        tools.clear();
        for (String s : c.getStringList("tools")) {
            Material m = Material.matchMaterial(s);
            if (m != null) tools.add(m);
        }
        disabledWorlds.clear();
        disabledWorlds.addAll(c.getStringList("disabled-worlds"));

        trees.clear();
        byLog.clear();
        allLogs.clear();
        ConfigurationSection sec = c.getConfigurationSection("trees");
        if (sec != null) for (String id : sec.getKeys(false)) {
            ConfigurationSection t = sec.getConfigurationSection(id);
            if (t == null) continue;
            Set<Material> logs = mats(t.getStringList("logs"), id);
            Set<Material> leaves = mats(t.getStringList("leaves"), id);
            if (logs.isEmpty()) continue;
            Material sap = t.contains("sapling") ? Material.matchMaterial(t.getString("sapling", "")) : null;
            TreeType tt = new TreeType(id, logs, leaves, t.getBoolean("natural-leaves", true),
                    t.getInt("min-leaves", 4), t.getInt("max-logs", 150), t.getInt("max-radius", 7), sap);
            trees.add(tt);
            for (Material m : logs) {
                byLog.computeIfAbsent(m, k -> new ArrayList<>()).add(tt);
                allLogs.add(m);
            }
        }
    }

    private Set<Material> mats(List<String> names, String tree) {
        Set<Material> out = EnumSet.noneOf(Material.class);
        for (String n : names) {
            Material m = Material.matchMaterial(n);
            if (m == null || !m.isBlock()) getLogger().warning("Strom '" + tree + "': neznámý blok " + n);
            else out.add(m);
        }
        return out;
    }

    // ------------------------------------------------------------ příkaz

    @Override
    public boolean onCommand(CommandSender s, Command cmd, String label, String[] args) {
        if (args.length > 0 && args[0].equalsIgnoreCase("reload")) {
            if (!s.hasPermission("wyldrevorubec.admin")) { s.sendMessage(msg("no-permission")); return true; }
            load();
            s.sendMessage(msg("reloaded"));
            return true;
        }
        if (!(s instanceof Player p)) { s.sendMessage("Jen pro hráče."); return true; }
        PersistentDataContainer pdc = p.getPersistentDataContainer();
        if (pdc.has(offKey, PersistentDataType.BYTE)) {
            pdc.remove(offKey);
            p.sendMessage(msg("enabled"));
        } else {
            pdc.set(offKey, PersistentDataType.BYTE, (byte) 1);
            p.sendMessage(msg("disabled"));
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender s, Command cmd, String alias, String[] args) {
        return args.length == 1 && s.hasPermission("wyldrevorubec.admin") ? List.of("reload") : List.of();
    }

    private String msg(String key) {
        String prefix = getConfig().getString("messages.prefix", "");
        return color(prefix + getConfig().getString("messages." + key, key));
    }

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

    // ------------------------------------------------------------ kmeny položené hráči (PDC chunku)

    private static long pack(Block b) {
        return ((long) (b.getY() + 2048) << 8) | ((long) (b.getX() & 15) << 4) | (b.getZ() & 15);
    }

    private boolean isPlaced(Block b) {
        long[] arr = b.getChunk().getPersistentDataContainer().get(placedKey, PersistentDataType.LONG_ARRAY);
        if (arr == null) return false;
        long k = pack(b);
        for (long v : arr) if (v == k) return true;
        return false;
    }

    private void setPlaced(Block b, boolean placed) {
        Chunk ch = b.getChunk();
        PersistentDataContainer pdc = ch.getPersistentDataContainer();
        long[] arr = pdc.get(placedKey, PersistentDataType.LONG_ARRAY);
        long k = pack(b);
        if (placed) {
            if (arr != null) for (long v : arr) if (v == k) return;
            long[] n = arr == null ? new long[1] : Arrays.copyOf(arr, arr.length + 1);
            n[n.length - 1] = k;
            pdc.set(placedKey, PersistentDataType.LONG_ARRAY, n);
        } else if (arr != null) {
            long[] n = Arrays.stream(arr).filter(v -> v != k).toArray();
            if (n.length == arr.length) return;
            if (n.length == 0) pdc.remove(placedKey);
            else pdc.set(placedKey, PersistentDataType.LONG_ARRAY, n);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent e) {
        if (allLogs.contains(e.getBlockPlaced().getType())) setPlaced(e.getBlockPlaced(), true);
    }

    // ------------------------------------------------------------ kácení

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent e) {
        Block start = e.getBlock();
        Material type = start.getType();
        if (!allLogs.contains(type)) return;
        Player p = e.getPlayer();
        boolean wasPlaced = isPlaced(start);
        if (wasPlaced) setPlaced(start, false);
        if (cutting.contains(p.getUniqueId())) return;          // naše vlastní rozbíjení
        if (wasPlaced) return;                                    // kmen položil hráč – kácí se jen ten blok
        if (p.getGameMode() == GameMode.CREATIVE || p.getGameMode() == GameMode.SPECTATOR) return;
        if (disabledWorlds.contains(start.getWorld().getName())) return;
        if (!p.hasPermission("wyldrevorubec.use")) return;
        if (p.getPersistentDataContainer().has(offKey, PersistentDataType.BYTE)) return;
        if (p.isSneaking() != requireSneak) return;
        ItemStack tool = p.getInventory().getItemInMainHand();
        if (!isAxe(tool.getType())) return;

        for (TreeType tt : byLog.getOrDefault(type, List.of())) {
            List<Block> logs = new ArrayList<>();
            Set<Block> leaves = new HashSet<>();
            if (scan(start, tt, logs, leaves)) {
                fell(p, start, tt, logs, leaves);
                return;
            }
        }
    }

    private boolean isAxe(Material m) {
        if (!tools.isEmpty()) return tools.contains(m);
        return m.name().endsWith("_AXE") && !m.name().endsWith("PICKAXE");
    }

    /** Projde strom od rozbitého kmene nahoru. Vrací true, když je to opravdu strom. */
    private boolean scan(Block start, TreeType tt, List<Block> logs, Set<Block> leaves) {
        ArrayDeque<Block> queue = new ArrayDeque<>();
        Set<Block> seen = new HashSet<>();
        queue.add(start);
        seen.add(start);
        int sx = start.getX(), sy = start.getY(), sz = start.getZ();
        while (!queue.isEmpty()) {
            Block b = queue.poll();
            logs.add(b);
            if (logs.size() > tt.maxLogs()) return false;           // moc velké – spíš stavba
            for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) for (int dz = -1; dz <= 1; dz++) {
                if (dx == 0 && dy == 0 && dz == 0) continue;
                Block n = b.getRelative(dx, dy, dz);
                if (n.getY() < sy) continue;                           // pařez pod místem seknutí necháme
                if (Math.abs(n.getX() - sx) > tt.maxRadius() || Math.abs(n.getZ() - sz) > tt.maxRadius()) continue;
                Material m = n.getType();
                if (tt.leaves().contains(m)) {
                    if (isNaturalLeaf(n, tt)) leaves.add(n);
                    continue;
                }
                if (!tt.logs().contains(m) || !seen.add(n)) continue;
                if (isPlaced(n)) return false;                         // napojené na hráčem položený kmen = stavba
                queue.add(n);
            }
        }
        return leaves.size() >= tt.minLeaves();
    }

    private boolean isNaturalLeaf(Block b, TreeType tt) {
        if (!tt.naturalLeaves()) return true;
        BlockData d = b.getBlockData();
        return d instanceof Leaves l && !l.isPersistent();
    }

    private void fell(Player p, Block start, TreeType tt, List<Block> logs, Set<Block> leaves) {
        logs.remove(start);
        logs.sort(Comparator.comparingInt(Block::getY));
        UUID id = p.getUniqueId();
        Location startLoc = start.getLocation();
        boolean stump = SOIL.contains(start.getRelative(0, -1, 0).getType());
        if (toInventory) cutBlocks.put(startLoc, id);

        Iterator<Block> it = logs.iterator();
        new BukkitRunnable() {
            @Override
            public void run() {
                if (!p.isOnline()) { finish(); return; }
                int n = perTick <= 0 ? Integer.MAX_VALUE : perTick;
                while (n-- > 0 && it.hasNext()) {
                    Block b = it.next();
                    if (!tt.logs().contains(b.getType())) continue;
                    ItemStack tool = p.getInventory().getItemInMainHand();
                    if (!isAxe(tool.getType())) { finish(); return; }
                    if (almostBroken(tool)) { p.sendMessage(msg("tool-low")); finish(); return; }
                    if (toInventory) cutBlocks.put(b.getLocation(), id);
                    cutting.add(id);
                    try {
                        p.breakBlock(b);                               // spustí ochrany (WorldGuard, Residence), dropy i opotřebení
                    } finally {
                        cutting.remove(id);
                    }
                    if (exhaustion > 0) p.setExhaustion(p.getExhaustion() + exhaustion);
                }
                if (!it.hasNext()) finish();
            }

            private void finish() {
                cancel();
                if (breakLeaves) for (Block l : leaves) if (tt.leaves().contains(l.getType())) l.breakNaturally();
                if (replant && stump && tt.sapling() != null) {
                    Block s = startLoc.getBlock();
                    if (s.getType().isAir() && SOIL.contains(s.getRelative(0, -1, 0).getType())) s.setType(tt.sapling());
                }
                Bukkit.getScheduler().runTaskLater(WylDrevorubec.this,
                        () -> cutBlocks.values().removeIf(u -> u.equals(id)), 2L);
            }
        }.runTaskTimer(this, 1L, 1L);
    }

    private static boolean almostBroken(ItemStack tool) {
        ItemMeta meta = tool.getItemMeta();
        if (!(meta instanceof Damageable d) || meta.isUnbreakable()) return false;
        int max = tool.getType().getMaxDurability();
        return max > 0 && max - d.getDamage() <= 2;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDrop(BlockDropItemEvent e) {
        UUID id = cutBlocks.remove(e.getBlock().getLocation());
        if (id == null) return;
        Player p = e.getPlayer();
        if (!p.getUniqueId().equals(id)) return;
        Iterator<Item> it = e.getItems().iterator();
        while (it.hasNext()) {
            Item item = it.next();
            Map<Integer, ItemStack> left = p.getInventory().addItem(item.getItemStack());
            if (left.isEmpty()) it.remove();
            else item.setItemStack(left.values().iterator().next());
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        cutting.remove(e.getPlayer().getUniqueId());
    }
}
