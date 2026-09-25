fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/meeting_audio.m");
        cc::Build::new()
            .file("native/meeting_audio.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("meeting_audio");
        for framework in ["Foundation", "CoreMedia", "CoreAudio"] {
            println!("cargo:rustc-link-lib=framework={}", framework);
        }
        // Keep microphone-only recording available on older macOS releases.
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    tauri_build::build();
}
