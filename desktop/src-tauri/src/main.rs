// Office Manager desktop app (2026-11-16, Paul: « un vrai programme d'installation »).
// A native window on the firm's server (office.eynowa.com): the firm's data never lives on this computer.
// - No native command is exposed to the web page (capabilities: none).
// - Only the firm's server and Google's sign-in page show in the window; other web / e-mail links open in the
//   person's browser or mail program, any other kind of link is dropped.
// - At start, the app looks for a new signed version on GitHub and offers to install it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::webview::WebviewWindowBuilder;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

// The firm's server: the ONLY site the window shows itself, with Google's sign-in page (accounts.google.com).
// Set when the installer is built (OM_SERVER_HOST, .github/workflows/desktop-release.yml); never a wildcard.
const SERVER_HOST: &str = match option_env!("OM_SERVER_HOST") {
    Some(h) => h,
    None => "office.eynowa.com",
};

fn stays_in_app(url: &tauri::Url) -> bool {
    match url.scheme() {
        // The local start page of the app (desktop/offline/index.html).
        "tauri" => true,
        // Windows serves the local start page from http(s)://tauri.localhost.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        // The server and Google: https only, default port only.
        "https" => url.port().is_none() && matches!(url.host_str(), Some(h) if h == SERVER_HOST || h == "accounts.google.com"),
        _ => false,
    }
}

// Only ordinary web links and e-mail links go to the person's own programs; any other scheme is dropped.
fn may_open_outside(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
}

async fn offer_update(app: tauri::AppHandle) {
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    let question = format!(
        "Une nouvelle version d'Office Manager est disponible ({}).\n\nL'installer maintenant ? L'application redémarrera.",
        update.version
    );
    let yes = app
        .dialog()
        .message(question)
        .title("Mise à jour")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Installer".into(), "Plus tard".into()))
        .blocking_show();
    if !yes {
        return;
    }
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(e) => {
            app.dialog()
                .message(format!("La mise à jour n'a pas pu être installée : {e}. L'application continue avec la version actuelle."))
                .title("Mise à jour")
                .kind(MessageDialogKind::Warning)
                .blocking_show();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The window is built here (not from the config alone) to decide where each link opens.
            let opener = app.handle().clone();
            let config = app.config().app.windows[0].clone();
            WebviewWindowBuilder::from_config(app, &config)?
                .on_navigation(move |url| {
                    if stays_in_app(url) {
                        return true;
                    }
                    // Another site: in the person's usual browser, the app window stays where it is.
                    if may_open_outside(url) {
                        let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            let handle = app.handle().clone();
            // blocking_show() must not run on the main thread: the update check runs on its own task.
            tauri::async_runtime::spawn(async move { offer_update(handle).await });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Office Manager n'a pas pu démarrer");
}
