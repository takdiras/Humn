use super::NowPlayingInfo;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, Once};
use std::time::Duration;

// Since macOS 15.4, MediaRemote ignores processes that aren't Apple-signed, so
// the helper (src/macos_helper.m, built by build.rs) runs inside /usr/bin/perl
// and streams one JSON line per poll: a NowPlayingInfo object or null.
const HELPER_DYLIB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libhumn_nowplaying.dylib"));

const PERL_LOADER: &str = r#"
use DynaLoader;
my $lib = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();
my $sym = DynaLoader::dl_find_symbol($lib, "humn_stream") or die DynaLoader::dl_error();
DynaLoader::dl_install_xsub("main::humn_stream", $sym);
humn_stream();
"#;

static LATEST: Mutex<Option<NowPlayingInfo>> = Mutex::new(None);
static START: Once = Once::new();

/// Writes the helper to the temp dir once per build (named by content hash).
fn helper_path() -> std::io::Result<PathBuf> {
    let mut hasher = DefaultHasher::new();
    HELPER_DYLIB.hash(&mut hasher);
    let path = std::env::temp_dir().join(format!("humn-nowplaying-{:016x}.dylib", hasher.finish()));
    if !path.exists() {
        let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&tmp, HELPER_DYLIB)?;
        std::fs::rename(&tmp, &path)?;
    }
    Ok(path)
}

/// Runs the helper until it exits, storing each snapshot in `LATEST`.
fn run_helper() -> std::io::Result<()> {
    let mut child = Command::new("/usr/bin/perl")
        .arg("-e")
        .arg(PERL_LOADER)
        .arg(helper_path()?)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let stdout = child.stdout.take().expect("stdout is piped");
    for line in BufReader::new(stdout).lines() {
        let info = serde_json::from_str::<Option<NowPlayingInfo>>(&line?).ok().flatten();
        *LATEST.lock().unwrap() = info;
    }
    child.wait()?;
    Ok(())
}

pub fn get_now_playing() -> Option<NowPlayingInfo> {
    START.call_once(|| {
        std::thread::spawn(|| loop {
            let _ = run_helper();
            *LATEST.lock().unwrap() = None;
            std::thread::sleep(Duration::from_secs(2));
        });
    });

    let info = LATEST.lock().unwrap().clone()?;
    if info.position_ms == 0 && info.duration_ms > 5000 {
        return None;
    }
    Some(info)
}
