use crate::configuration::state::ServiceAccess;
use crate::entity::setting::Setting;
use crate::repository::settings_repository::{get_setting, insert_or_update_setting};
use platypus_notes::models::effort_options;
use std::collections::BTreeMap;

pub fn saved_effort(app: &tauri::AppHandle, model: &str) -> Option<String> {
    app.db(|db| {
        get_setting(db, "model_efforts").ok()
            .and_then(|setting| serde_json::from_str::<BTreeMap<String, String>>(&setting.setting_value).ok())
            .and_then(|preferences| preferences.get(model).cloned())
    })
}

#[tauri::command]
pub fn set_model_effort(app_handle: tauri::AppHandle, model: String, effort: String) -> Result<BTreeMap<String, String>, String> {
    if !effort_options(&model).contains(&effort.as_str()) {
        return Err("This effort level isn't supported by the selected model.".into());
    }
    app_handle.db(|db| {
        let mut preferences = get_setting(db, "model_efforts").ok()
            .and_then(|setting| serde_json::from_str::<BTreeMap<String, String>>(&setting.setting_value).ok())
            .unwrap_or_default();
        preferences.insert(model, effort);
        insert_or_update_setting(db, Setting {
            setting_key: "model_efforts".into(),
            setting_value: serde_json::to_string(&preferences).map_err(|e| e.to_string())?,
        }).map_err(|e| e.to_string())?;
        Ok(preferences)
    })
}
