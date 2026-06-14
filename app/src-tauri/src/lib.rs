mod sidecar;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Default)]
pub struct AppState {
    sidecar: Mutex<Option<sidecar::SidecarHandle>>,
    tray: Mutex<Option<TrayIcon>>,
    skill_names: Mutex<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkillEvent {
    pub skill_id: String,
    pub event: serde_json::Value,
}

fn get_sidecar(state: &State<'_, AppState>) -> Result<sidecar::SidecarHandle, String> {
    let handle = state.sidecar.lock().unwrap();
    handle.as_ref().cloned().ok_or_else(|| "Sidecar not running".to_string())
}

#[tauri::command]
async fn create_session(
    _app: AppHandle,
    state: State<'_, AppState>,
    skill_id: String,
    cwd: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "create-session",
        "skillId": skill_id,
        "cwd": cwd,
    }))
    .await
}

#[tauri::command]
async fn invoke_skill(
    state: State<'_, AppState>,
    skill_id: String,
    prompt: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "invoke",
        "skillId": skill_id,
        "prompt": prompt,
    }))
    .await
}

#[tauri::command]
async fn steer_skill(
    state: State<'_, AppState>,
    skill_id: String,
    text: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "steer",
        "skillId": skill_id,
        "text": text,
    }))
    .await
}

#[tauri::command]
async fn cancel_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "cancel",
        "skillId": skill_id,
    }))
    .await
}

#[tauri::command]
async fn answer_question(
    state: State<'_, AppState>,
    skill_id: String,
    request_id: String,
    answers: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "answer-question",
        "skillId": skill_id,
        "requestId": request_id,
        "answers": answers,
    }))
    .await
}

#[tauri::command]
async fn get_history(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "get-history",
        "skillId": skill_id,
    }))
    .await
}

#[tauri::command]
async fn discover_skills(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({"type": "discover-skills"})).await
}

#[tauri::command]
async fn scorecard(state: State<'_, AppState>, skill_id: String) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({ "type": "scorecard", "skillId": skill_id })).await
}

#[tauri::command]
async fn batch_generate(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({ "type": "batch-generate", "skillIds": skill_ids })).await
}

#[tauri::command]
async fn run_evolution(state: State<'_, AppState>, skill_id: String) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({ "type": "run-evolution", "skillId": skill_id })).await
}

#[tauri::command]
async fn evolution_keep(
    state: State<'_, AppState>,
    skill_id: String,
    adaptation_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "evolution-keep", "skillId": skill_id, "adaptationId": adaptation_id
    }))
    .await
}

#[tauri::command]
async fn evolution_revert(
    state: State<'_, AppState>,
    skill_id: String,
    adaptation_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "evolution-revert", "skillId": skill_id, "adaptationId": adaptation_id
    }))
    .await
}

#[tauri::command]
async fn modify_ui(
    state: State<'_, AppState>,
    skill_id: String,
    instruction: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "modify-ui",
        "skillId": skill_id,
        "instruction": instruction,
    }))
    .await
}

#[tauri::command]
async fn list_ui_versions(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "list-ui-versions",
        "skillId": skill_id,
    }))
    .await
}

#[tauri::command]
async fn revert_ui(
    state: State<'_, AppState>,
    skill_id: String,
    hash: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "revert-ui",
        "skillId": skill_id,
        "hash": hash,
    }))
    .await
}

#[tauri::command]
async fn generate_ui(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "generate-ui",
        "skillId": skill_id,
    }))
    .await
}

#[tauri::command]
async fn load_ui(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    let sc = get_sidecar(&state)?;
    sc.send(serde_json::json!({
        "type": "load-ui",
        "skillId": skill_id,
    }))
    .await
}

#[tauri::command]
async fn open_skill_window(app: AppHandle, skill_id: String, skill_name: String) -> Result<(), String> {
    let label = format!("skill-{}", skill_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App(format!("index.html?window=skill&id={}&name={}", skill_id, skill_name).into());
    WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("RecursiveUI — {}", skill_name))
        .inner_size(1000.0, 700.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn open_studio_window(app: AppHandle) -> Result<(), String> {
    open_studio(app, false, None).await
}

#[tauri::command]
async fn open_studio_for_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    open_studio(app, false, Some(skill_id)).await
}

async fn open_studio_batch_window(app: AppHandle) -> Result<(), String> {
    open_studio(app, true, None).await
}

#[tauri::command]
async fn open_spectacle_window(app: AppHandle) -> Result<(), String> {
    let label = "spectacle";
    if let Some(window) = app.get_webview_window(label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html?window=spectacle".into()))
        .title("RecursiveUI")
        .inner_size(1100.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn open_studio(app: AppHandle, batch: bool, skill: Option<String>) -> Result<(), String> {
    let label = "studio";
    if let Some(window) = app.get_webview_window(label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut url = "index.html?window=studio".to_string();
    if batch {
        url.push_str("&batch=1");
    }
    if let Some(s) = skill {
        url.push_str("&skill=");
        url.push_str(&s);
    }
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title("RecursiveUI — Design Studio")
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct DiscoveredSkill {
    skill_id: String,
    name: String,
    category: String,
    #[serde(default)]
    tier: String,
    has_ui: bool,
}

fn skill_label(skill: &DiscoveredSkill) -> String {
    if skill.has_ui {
        format!("◆ {}", skill.name)
    } else {
        skill.name.clone()
    }
}

fn build_tray_menu(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Boot menu: shown until discovery rebuilds it with the real skill list
    let loading = MenuItemBuilder::with_id("noop", "Scanning skills…")
        .enabled(false)
        .build(app)?;
    let sep = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit RecursiveUI").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&loading, &sep, &quit]).build()?;

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(false)
        .title("RecursiveUI")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().0.as_str();
            if id == "quit" {
                app.exit(0);
            } else if id == "open-studio" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_studio_window(app).await;
                });
            } else if id == "open-spectacle" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_spectacle_window(app).await;
                });
            } else if id == "generate-all" {
                // Batch generation is confirmed and driven from the Studio,
                // not fired blindly from the tray (backlog #5)
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = open_studio_batch_window(app).await;
                });
            } else if let Some(skill_id) = id.strip_prefix("skill:") {
                let app = app.clone();
                let skill_id = skill_id.to_string();
                let skill_name = {
                    let state = app.state::<AppState>();
                    let names = state.skill_names.lock().unwrap();
                    names.get(&skill_id).cloned().unwrap_or_else(|| skill_id.clone())
                };
                tauri::async_runtime::spawn(async move {
                    let _ = open_skill_window(app, skill_id, skill_name).await;
                });
            }
        })
        .build(app)?;

    let state = app.state::<AppState>();
    *state.tray.lock().unwrap() = Some(tray);
    Ok(())
}

/// Ask the sidecar for the skill inventory and rebuild the tray menu:
/// priority/generated skills on top, the rest in category submenus.
async fn rebuild_tray_from_discovery(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(sc) = get_sidecar(&state) else { return };
    let Ok(response) = sc.send(serde_json::json!({"type": "discover-skills"})).await else {
        return;
    };

    let skills: Vec<DiscoveredSkill> = response
        .get("skills")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let priority: Vec<String> = response
        .get("priority")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    {
        let mut names = state.skill_names.lock().unwrap();
        names.clear();
        for s in &skills {
            names.insert(s.skill_id.clone(), s.name.clone());
        }
    }

    if let Err(e) = (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut builder = MenuBuilder::new(app);

        // Section 1: personal skills (project/pi) — the design doc's tier 1
        let personal: Vec<&DiscoveredSkill> =
            skills.iter().filter(|s| s.tier == "personal").take(8).collect();
        if !personal.is_empty() {
            let header = MenuItemBuilder::with_id("noop-mine", "My Skills")
                .enabled(false)
                .build(app)?;
            builder = builder.item(&header);
            for s in &personal {
                let item = MenuItemBuilder::with_id(format!("skill:{}", s.skill_id), skill_label(s))
                    .build(app)?;
                builder = builder.item(&item);
            }
            builder = builder.separator();
        }

        // Section 2: generated UIs + the priority list, capped
        let mut top_count = 0;
        for s in &skills {
            if top_count >= 12 {
                break;
            }
            if s.tier != "personal" && (s.has_ui || priority.contains(&s.skill_id)) {
                let item = MenuItemBuilder::with_id(format!("skill:{}", s.skill_id), skill_label(s))
                    .build(app)?;
                builder = builder.item(&item);
                top_count += 1;
            }
        }

        builder = builder.separator();

        // Everything else, grouped by category
        let mut categories: Vec<String> = skills.iter().map(|s| s.category.clone()).collect();
        categories.sort();
        categories.dedup();
        let mut all_skills = SubmenuBuilder::new(app, format!("All Skills ({})", skills.len()));
        for category in categories {
            let mut sub = SubmenuBuilder::new(app, &category);
            for s in skills.iter().filter(|s| s.category == category) {
                let item = MenuItemBuilder::with_id(format!("skill:{}", s.skill_id), skill_label(s))
                    .build(app)?;
                sub = sub.item(&item);
            }
            let sub = sub.build()?;
            all_skills = all_skills.item(&sub);
        }
        let all_skills = all_skills.build()?;
        builder = builder.item(&all_skills);

        let generate_all =
            MenuItemBuilder::with_id("generate-all", "⚡ Generate UIs for Priority Skills").build(app)?;
        let spectacle = MenuItemBuilder::with_id("open-spectacle", "✦ Spectacle (first-run view)").build(app)?;
        let studio = MenuItemBuilder::with_id("open-studio", "Open Studio").build(app)?;
        let quit = MenuItemBuilder::with_id("quit", "Quit RecursiveUI").build(app)?;
        let menu = builder
            .separator()
            .item(&generate_all)
            .item(&spectacle)
            .item(&studio)
            .separator()
            .item(&quit)
            .build()?;

        let tray_guard = state.tray.lock().unwrap();
        if let Some(tray) = tray_guard.as_ref() {
            tray.set_menu(Some(menu))?;
        }
        Ok(())
    })() {
        eprintln!("[recursiveui] tray rebuild failed: {}", e);
    } else {
        eprintln!("[recursiveui] tray rebuilt with {} skills", skills.len());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            create_session,
            invoke_skill,
            steer_skill,
            cancel_skill,
            answer_question,
            get_history,
            generate_ui,
            load_ui,
            discover_skills,
            modify_ui,
            list_ui_versions,
            revert_ui,
            scorecard,
            batch_generate,
            run_evolution,
            evolution_keep,
            evolution_revert,
            open_skill_window,
            open_studio_window,
            open_studio_for_skill,
            open_spectacle_window,
        ])
        .setup(|app| {
            build_tray_menu(app.handle())?;

            // Boot sidecar
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::boot_sidecar(&app_handle).await {
                    Ok(handle) => {
                        {
                            let state = app_handle.state::<AppState>();
                            *state.sidecar.lock().unwrap() = Some(handle);
                        }
                        eprintln!("[recursiveui] sidecar started");
                        rebuild_tray_from_discovery(&app_handle).await;
                    }
                    Err(e) => {
                        eprintln!("[recursiveui] sidecar failed to start: {}", e);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // Tray app: closing the last window must not quit the app.
            // ExitRequested with no code = last-window-closed; explicit
            // app.exit(0) from the Quit menu item carries a code and passes.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
