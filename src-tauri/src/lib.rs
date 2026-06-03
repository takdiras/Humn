mod lyrics;

#[cfg(target_os = "windows")]
mod smtc;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod linux;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NowPlayingInfo {
    pub title: String,
    pub artist: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub is_playing: bool,
}

fn get_info() -> Option<NowPlayingInfo> {
    #[cfg(target_os = "windows")]
    return smtc::get_now_playing();

    #[cfg(target_os = "macos")]
    return macos::get_now_playing();

    #[cfg(target_os = "linux")]
    return linux::get_now_playing();

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    None
}

#[tauri::command]
fn get_now_playing() -> Option<NowPlayingInfo> {
    get_info()
}

fn start_now_playing_polling(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_title = String::new();
        let mut last_artist = String::new();

        loop {
            match get_info() {
                Some(info) => {
                    let track_changed =
                        info.title != last_title || info.artist != last_artist;
                    if track_changed {
                        last_title.clone_from(&info.title);
                        last_artist.clone_from(&info.artist);
                        let _ = app_handle.emit("track-changed", &info);
                    }
                    let _ = app_handle.emit("position-tick", &info);
                }
                None => {
                    if !last_title.is_empty() || !last_artist.is_empty() {
                        last_title.clear();
                        last_artist.clear();
                        let _ = app_handle.emit("track-changed", serde_json::Value::Null);
                    }
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Humn")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            start_now_playing_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_now_playing,
            lyrics::stream_lyrics,
            lyrics::verify_turnstile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
