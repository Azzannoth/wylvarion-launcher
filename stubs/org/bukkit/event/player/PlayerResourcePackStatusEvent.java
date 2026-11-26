package org.bukkit.event.player;
public class PlayerResourcePackStatusEvent extends PlayerEvent {
 public enum Status { SUCCESSFULLY_LOADED, DECLINED, FAILED_DOWNLOAD, ACCEPTED, DOWNLOADED, INVALID_URL, FAILED_RELOAD, DISCARDED }
 public Status getStatus(){return null;}
}
