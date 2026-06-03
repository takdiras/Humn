use super::NowPlayingInfo;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

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

/// Called every poll — reuses a thread-local session manager to avoid per-call COM overhead.
pub fn get_now_playing() -> Option<NowPlayingInfo> {
    use std::cell::OnceCell;

    thread_local! {
        static MANAGER: OnceCell<Option<GlobalSystemMediaTransportControlsSessionManager>> =
            OnceCell::new();
    }

    MANAGER.with(|cell| {
        let manager = cell.get_or_init(get_session_manager);
        get_current_session_info_with_manager(manager.as_ref())
    })
}

/// One-shot query without a persistent manager (used by the Tauri command).
pub fn get_current_session_info() -> Option<NowPlayingInfo> {
    let manager = get_session_manager();
    get_current_session_info_with_manager(manager.as_ref())
}
