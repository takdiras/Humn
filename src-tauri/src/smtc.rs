use serde::{Deserialize, Serialize};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingInfo {
    pub title: String,
    pub artist: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub is_playing: bool,
}

pub fn get_session_manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()
}

pub fn get_current_session_info_with_manager(
    manager: Option<&GlobalSystemMediaTransportControlsSessionManager>,
) -> Option<NowPlayingInfo> {
    let session = manager?.GetCurrentSession().ok()?;

    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let timeline = session.GetTimelineProperties().ok()?;
    let playback_info = session.GetPlaybackInfo().ok()?;

    let title = props.Title().ok()?.to_string();
    let artist = props.Artist().ok()?.to_string();

    if title.is_empty() && artist.is_empty() {
        return None;
    }

    let position_ms = timeline.Position().map(|t| t.Duration / 10_000).unwrap_or(0);
    let duration_ms = timeline.EndTime().map(|t| t.Duration / 10_000).unwrap_or(0);

    if position_ms == 0 && duration_ms > 5000 {
        return None;
    }

    let status = playback_info.PlaybackStatus().ok()?;
    let is_playing =
        status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;

    Some(NowPlayingInfo {
        title,
        artist,
        position_ms,
        duration_ms,
        is_playing,
    })
}

/// Read the current SMTC session and return track info, or None if nothing is playing.
pub fn get_current_session_info() -> Option<NowPlayingInfo> {
    let manager = get_session_manager();
    get_current_session_info_with_manager(manager.as_ref())
}
