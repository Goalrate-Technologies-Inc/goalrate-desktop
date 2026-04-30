fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let swift_cache_dir = out_dir.join("swiftpm-cache");
        let clang_module_cache_dir = out_dir.join("clang-module-cache");
        std::fs::create_dir_all(&swift_cache_dir).unwrap();
        std::fs::create_dir_all(&clang_module_cache_dir).unwrap();
        std::env::set_var("SWIFTPM_MODULECACHE_OVERRIDE", &swift_cache_dir);
        std::env::set_var("CLANG_MODULE_CACHE_PATH", &clang_module_cache_dir);

        swift_rs::SwiftLinker::new("10.15")
            .with_package("GoalrateStoreKit", "storekit")
            .link();
        println!("cargo:rustc-link-lib=framework=StoreKit");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    // Ensure icon updates invalidate the Rust build in dev and release builds.
    println!("cargo:rerun-if-changed=icons/icon.svg");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=tauri.appstore.conf.json");
    println!("cargo:rerun-if-changed=storekit/Package.swift");
    println!("cargo:rerun-if-changed=storekit/Sources/GoalrateStoreKit/GoalrateStoreKit.swift");
    tauri_build::build()
}
