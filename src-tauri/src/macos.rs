use super::NowPlayingInfo;
use block::ConcreteBlock;
use core_foundation::{
    base::{CFType, TCFType},
    dictionary::CFDictionary,
    number::CFNumber,
    string::CFString,
};
use libloading::Library;
use std::ffi::c_void;
use std::sync::mpsc;
use std::time::Duration;

// GCD is part of libSystem on macOS — always linked.
#[link(name = "System")]
extern "C" {
    // QOS_CLASS_DEFAULT = 0x15
    fn dispatch_get_global_queue(identifier: i64, flags: u64) -> *mut c_void;
}

// Keep MediaRemote.framework open for the lifetime of the polling thread.
thread_local! {
    static MEDIA_REMOTE: Option<Library> = unsafe {
        Library::new(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
        )
        .ok()
    };
}

fn cf_string(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
    let k = CFString::new(key);
    dict.find(&k)
        .and_then(|v| v.downcast::<CFString>())
        .map(|s| s.to_string())
}

fn cf_f64(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<f64> {
    let k = CFString::new(key);
    dict.find(&k)
        .and_then(|v| v.downcast::<CFNumber>())
        .and_then(|n| n.to_f64())
}

fn parse_dict(dict_ref: *mut c_void) -> Option<NowPlayingInfo> {
    if dict_ref.is_null() {
        return None;
    }
    let dict = unsafe {
        CFDictionary::<CFString, CFType>::wrap_under_get_rule(dict_ref as _)
    };

    let title = cf_string(&dict, "kMRMediaRemoteNowPlayingInfoTitle").unwrap_or_default();
    let artist = cf_string(&dict, "kMRMediaRemoteNowPlayingInfoArtist").unwrap_or_default();

    if title.is_empty() && artist.is_empty() {
        return None;
    }

    let duration_ms = cf_f64(&dict, "kMRMediaRemoteNowPlayingInfoDuration")
        .map(|d| (d * 1000.0) as i64)
        .unwrap_or(0);
    let position_ms = cf_f64(&dict, "kMRMediaRemoteNowPlayingInfoElapsedTime")
        .map(|p| (p * 1000.0) as i64)
        .unwrap_or(0);
    let is_playing = cf_f64(&dict, "kMRMediaRemoteNowPlayingInfoPlaybackRate")
        .map(|r| r > 0.0)
        .unwrap_or(false);

    if position_ms == 0 && duration_ms > 5000 {
        return None;
    }

    Some(NowPlayingInfo {
        title,
        artist,
        position_ms,
        duration_ms,
        is_playing,
    })
}

pub fn get_now_playing() -> Option<NowPlayingInfo> {
    let (tx, rx) = mpsc::channel::<Option<NowPlayingInfo>>();

    let handler = ConcreteBlock::new(move |dict_ref: *mut c_void| {
        let _ = tx.send(parse_dict(dict_ref));
    });
    let handler = handler.copy();

    MEDIA_REMOTE.with(|lib_opt| -> Option<()> {
        let lib = lib_opt.as_ref()?;
        unsafe {
            type GetNowPlayingFn = unsafe extern "C" fn(*mut c_void, *const c_void);
            let func: libloading::Symbol<GetNowPlayingFn> =
                lib.get(b"MRMediaRemoteGetNowPlayingInfo").ok()?;
            let queue = dispatch_get_global_queue(0x15, 0);
            func(queue, &*handler as *const _ as *const c_void);
        }
        Some(())
    })?;

    rx.recv_timeout(Duration::from_millis(200)).ok().flatten()
}
