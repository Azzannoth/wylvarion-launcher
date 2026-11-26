package org.bukkit;
public interface OfflinePlayer { String getName(); java.util.UUID getUniqueId(); long getFirstPlayed(); long getLastPlayed(); long getLastSeen(); boolean isOnline(); boolean hasPlayedBefore(); int getStatistic(Statistic s); }
