use std::path::PathBuf;
use std::process::Command;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_helper();
    }
    tauri_build::build()
}

/// Compiles the MediaRemote helper that macos.rs embeds and loads into /usr/bin/perl.
/// Built universal so it matches whichever slice of perl gets launched.
fn build_macos_helper() {
    let src = "src/macos_helper.m";
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("libhumn_nowplaying.dylib");
    let min_version = std::env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "10.13".into());

    println!("cargo:rerun-if-changed={src}");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");

    let status = Command::new("clang")
        .args(["-dynamiclib", "-fobjc-arc", "-O2", "-arch", "arm64", "-arch", "x86_64"])
        .arg(format!("-mmacosx-version-min={min_version}"))
        .args(["-framework", "Foundation", src, "-o"])
        .arg(&out)
        .status()
        .expect("failed to run clang");
    assert!(status.success(), "failed to compile {src}");
}
