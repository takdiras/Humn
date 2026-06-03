use super::NowPlayingInfo;
use mpris::{PlaybackStatus, PlayerFinder};

pub fn get_now_playing() -> Option<NowPlayingInfo> {
    let finder = PlayerFinder::new().ok()?;
    let player = finder.find_active().ok()?;

    let metadata = player.get_metadata().ok()?;

    let title = metadata.title().unwrap_or("").to_string();
    let artist = metadata
        .artists()
        .map(|a| a.join(", "))
        .unwrap_or_default();

    if title.is_empty() && artist.is_empty() {
        return None;
    }

    let duration_ms = metadata
        .length()
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let position_ms = player
        .get_position()
        .ok()
        .map(|p| p.as_millis() as i64)
        .unwrap_or(0);

    if position_ms == 0 && duration_ms > 5000 {
        return None;
    }

    let is_playing = matches!(
        player.get_playback_status().ok(),
        Some(PlaybackStatus::Playing)
    );

    Some(NowPlayingInfo {
        title,
        artist,
        position_ms,
        duration_ms,
        is_playing,
    })
}
