package me.clip.placeholderapi.expansion;
public abstract class PlaceholderExpansion {
 public abstract String getIdentifier(); public abstract String getAuthor(); public abstract String getVersion();
 public boolean persist(){return false;} public boolean canRegister(){return true;}
 public String onPlaceholderRequest(org.bukkit.entity.Player p, String params){return null;}
 public String onRequest(org.bukkit.OfflinePlayer p, String params){return null;}
 public boolean register(){return true;}
}
