mod smtc;
mod lyrics;

use smtc::NowPlayingInfo;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[tauri::command]
fn get_now_playing() -> Option<NowPlayingInfo> {
    smtc::get_current_session_info()
}

/// Spawn a background thread that polls SMTC every 100 ms and emits Tauri events.
fn start_smtc_polling(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_title = String::new();
        let mut last_artist = String::new();
        let manager = smtc::get_session_manager();

        loop {
            match smtc::get_current_session_info_with_manager(manager.as_ref()) {
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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            setup_tray(app)?;
            start_smtc_polling(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_now_playing, lyrics::stream_lyrics, lyrics::verify_turnstile])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

