package cz.wylvarion.pack;

import me.clip.placeholderapi.PlaceholderAPI;
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import me.clip.placeholderapi.expansion.Relational;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerResourcePackStatusEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * WylPack – pamatuje si, kdo má načtený resource pack serveru, a podle toho ukazuje
 * v TABu (tab list, nametag, scoreboard) buď obrázky z ItemsAdderu, nebo text.
 *
 * Placeholdery:
 *   %wylpack_has%            yes / no
 *   %wylpack_img_<jméno>%    obrázek %img_<jméno>% s packem, jinak náhradní symbol
 *   %rel_wylpack_rank%       ranky hráče (hlavní + questový) podle toho, jestli DÍVAJÍCÍ SE má pack
 */
public final class WylPack extends JavaPlugin implements Listener {

    private static final String MAIN = "%luckperms_prefix_element_highest_not_on_track_quest%";
    private static final String QUEST = "%luckperms_prefix_element_highest_on_track_quest%";
    private static final Pattern LANG = Pattern.compile("<lang:([^>]+)>");

    /** klíč překladu z prefixu LuckPerms -> znak obrázku ranku v packu */
    private static final Map<String, String> RANK_GLYPH = new HashMap<>();
    /** jméno obrázku -> náhrada bez packu */
    private static final Map<String, String> IMG_FALLBACK = new HashMap<>();

    static {
        Object[][] r = {
            {"OWNER", 0xe010}, {"CO-OWNER", 0xe011}, {"HL.ADMIN", 0xe05f}, {"ADMIN", 0xe012}, {"TECHNIK", 0xe013},
            {"HL.MOD", 0xe060}, {"MOD", 0xe014}, {"HL.HELPER", 0xe061}, {"HELPER", 0xe015}, {"HL.BUILDER", 0xe062},
            {"BUILDER", 0xe016}, {"HL.EVENTER", 0xe063}, {"EVENTER", 0xe017}, {"SPONZOR", 0xe018}, {"FALLEN", 0xe019},
            {"GLACIAL", 0xe01e}, {"INFERNO", 0xe020}, {"TITAN", 0xe01b}, {"ETERNAL", 0xe01a}, {"CELESTIAL", 0xe01c},
            {"GOD", 0xe01f}, {"LEGEND", 0xe01d}, {"STREAMER", 0xe021}, {"WANDERER", 0xe03d}, {"PATHFINDER", 0xe03e},
            {"IRONCLAD", 0xe03f}, {"WARLORD", 0xe040}, {"SHADOWBLADE", 0xe041}, {"VOIDWALKER", 0xe042},
            {"HARBINGER", 0xe043}, {"GODSLAYER", 0xe044}, {"MYTHIC", 0xe045}, {"ASCENDED", 0xe046},
            {"IMMORTAL", 0xe047}, {"PARAGON", 0xe048}, {"OMEGA", 0xe049}, {"HARDCORE", 0xe04a},
        };
        for (Object[] e : r) RANK_GLYPH.put((String) e[0], String.valueOf((char) (int) (Integer) e[1]));
        IMG_FALLBACK.put("wylvarion", "<gradient:#5BC8FF:#6B38DD><bold>WYLVARION</bold></gradient>");
        IMG_FALLBACK.put("zabiti", "<#C1432E>⚔</#C1432E>");
        IMG_FALLBACK.put("umrti", "<gray>☠</gray>");
        IMG_FALLBACK.put("mince", "<#E8A23D>●</#E8A23D>");
        IMG_FALLBACK.put("zlataky", "<#E8A23D>●</#E8A23D>");
        IMG_FALLBACK.put("gems", "<#5BC8FF>♦</#5BC8FF>");
        IMG_FALLBACK.put("gemy", "<#5BC8FF>♦</#5BC8FF>");
        IMG_FALLBACK.put("tymy", "<#C084FC>⚑</#C084FC>");
        IMG_FALLBACK.put("voteparty", "<#A855F7>✪</#A855F7>");
    }

    private final Set<UUID> withPack = ConcurrentHashMap.newKeySet();
    private File store;

    @Override
    public void onEnable() {
        File dir = getDataFolder();
        if (!dir.exists()) dir.mkdirs();
        store = new File(dir, "s-packem.txt");
        try {
            if (store.exists()) for (String l : Files.readAllLines(store.toPath(), StandardCharsets.UTF_8)) {
                l = l.trim();
                if (!l.isEmpty()) try { withPack.add(UUID.fromString(l)); } catch (IllegalArgumentException ignored) { }
            }
        } catch (Exception e) {
            getLogger().warning("Nepodařilo se načíst " + store.getName() + ": " + e);
        }
        Bukkit.getPluginManager().registerEvents(this, this);
        if (Bukkit.getPluginManager().isPluginEnabled("PlaceholderAPI")) {
            new Expansion().register();
            getLogger().info("WylPack zapnutý (" + withPack.size() + " hráčů s packem v paměti).");
        } else {
            getLogger().warning("Chybí PlaceholderAPI – placeholdery WylPack nebudou fungovat.");
        }
    }

    @Override
    public void onDisable() { save(); }

    private synchronized void save() {
        try {
            StringBuilder sb = new StringBuilder();
            for (UUID u : withPack) sb.append(u).append('\n');
            Files.write(store.toPath(), sb.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            getLogger().warning("Nepodařilo se uložit " + store.getName() + ": " + e);
        }
    }

    @EventHandler
    public void onPack(PlayerResourcePackStatusEvent e) {
        UUID id = e.getPlayer().getUniqueId();
        boolean changed;
        switch (e.getStatus()) {
            case SUCCESSFULLY_LOADED: changed = withPack.add(id); break;
            case DECLINED: case FAILED_DOWNLOAD: case INVALID_URL: case FAILED_RELOAD: case DISCARDED:
                changed = withPack.remove(id); break;
            default: return;
        }
        if (changed) save();
    }

    private boolean hasPack(OfflinePlayer p) {
        if (p == null) return false;
        UUID id = p.getUniqueId();
        if (id.toString().startsWith("00000000-0000-0000")) return false; // Bedrock (Floodgate)
        return withPack.contains(id);
    }

    /** Prefix z LuckPerms (MiniMessage s &lt;lang:KLÍČ&gt;) -> obrázek, nebo beze změny (TAB z něj udělá barevný text). */
    private static String rank(String prefix, boolean pack) {
        if (prefix == null || prefix.isEmpty() || prefix.startsWith("%")) return "";
        if (!pack) return prefix;
        Matcher m = LANG.matcher(prefix);
        if (m.find()) {
            String g = RANK_GLYPH.get(m.group(1));
            if (g != null) return "<white>" + g + "</white> ";
        }
        return prefix;
    }

    private final class Expansion extends PlaceholderExpansion implements Relational {
        @Override public String getIdentifier() { return "wylpack"; }
        @Override public String getAuthor() { return "Wylvarion"; }
        @Override public String getVersion() { return "1.0.0"; }
        @Override public boolean persist() { return true; }

        @Override
        public String onRequest(OfflinePlayer p, String params) {
            if (params.equals("has")) return hasPack(p) ? "yes" : "no";
            if (params.startsWith("img_")) {
                String name = params.substring(4);
                if (hasPack(p)) return PlaceholderAPI.setPlaceholders(p, "%img_" + name + "%");
                return IMG_FALLBACK.getOrDefault(name, "");
            }
            if (params.equals("rank")) {
                boolean pk = hasPack(p);
                return rank(PlaceholderAPI.setPlaceholders(p, MAIN), pk) + rank(PlaceholderAPI.setPlaceholders(p, QUEST), pk);
            }
            return null;
        }

        @Override
        public String onPlaceholderRequest(Player viewer, Player target, String params) {
            if (!params.equals("rank") || target == null) return null;
            boolean pk = hasPack(viewer);
            return rank(PlaceholderAPI.setPlaceholders(target, MAIN), pk) + rank(PlaceholderAPI.setPlaceholders(target, QUEST), pk);
        }
    }
}
