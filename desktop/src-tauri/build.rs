fn main() {
    // The firm's server address is read when compiling (src/main.rs, SERVER_HOST): rebuild when it changes.
    println!("cargo:rerun-if-env-changed=OM_SERVER_HOST");
    tauri_build::build()
}
