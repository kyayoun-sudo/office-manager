// Desktop shell for Office Manager: opens the hosted web app in a native window.
// No local file access and no native command is exposed to the web page.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Office Manager n'a pas pu démarrer");
}
