//! Memory markdown commands.

use chrono::Utc;
use tauri::State;
use vault_core::VaultManager;

use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTimeWindow {
    pub label: String,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub days: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryImportantDay {
    pub label: String,
    pub date: String,
    #[serde(default)]
    pub recurrence: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConsentInput {
    #[serde(default)]
    pub use_for_planning: bool,
    #[serde(default)]
    pub allow_ai_updates_from_chat: bool,
    #[serde(default)]
    pub allow_remote_ai_context: bool,
    #[serde(default = "default_require_confirmation")]
    pub require_confirmation_for_sensitive_updates: bool,
}

fn default_require_confirmation() -> bool {
    true
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInput {
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub age: Option<u32>,
    #[serde(default)]
    pub important_days: Vec<MemoryImportantDay>,
    #[serde(default)]
    pub likes: Vec<String>,
    #[serde(default)]
    pub dislikes: Vec<String>,
    #[serde(default)]
    pub limitations: Vec<String>,
    #[serde(default)]
    pub meal_windows: Vec<MemoryTimeWindow>,
    #[serde(default)]
    pub snack_windows: Vec<MemoryTimeWindow>,
    #[serde(default)]
    pub exercise_minutes_needed: Option<u32>,
    #[serde(default)]
    pub socialization_minutes_needed: Option<u32>,
    #[serde(default)]
    pub self_care_minutes_needed: Option<u32>,
    #[serde(default)]
    pub task_capacity_hours_per_day: Option<f64>,
    #[serde(default)]
    pub sleep_hours_needed: Option<f64>,
    #[serde(default)]
    pub downtime_hours_needed: Option<f64>,
    pub consent: MemoryConsentInput,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AssistantMemoryUpdate {
    pub reason: Option<String>,
    pub sensitive: bool,
    pub confirmed_by_user: bool,
    pub user_name: Option<String>,
    pub age: Option<u32>,
    pub important_days_to_add: Vec<MemoryImportantDay>,
    pub likes_to_add: Vec<String>,
    pub dislikes_to_add: Vec<String>,
    pub limitations_to_add: Vec<String>,
    pub meal_windows_to_add: Vec<MemoryTimeWindow>,
    pub snack_windows_to_add: Vec<MemoryTimeWindow>,
    pub exercise_minutes_needed: Option<u32>,
    pub socialization_minutes_needed: Option<u32>,
    pub self_care_minutes_needed: Option<u32>,
    pub task_capacity_hours_per_day: Option<f64>,
    pub sleep_hours_needed: Option<f64>,
    pub downtime_hours_needed: Option<f64>,
    pub notes_to_add: Vec<String>,
}

impl AssistantMemoryUpdate {
    pub fn is_empty(&self) -> bool {
        self.user_name.is_none()
            && self.age.is_none()
            && self.important_days_to_add.is_empty()
            && self.likes_to_add.is_empty()
            && self.dislikes_to_add.is_empty()
            && self.limitations_to_add.is_empty()
            && self.meal_windows_to_add.is_empty()
            && self.snack_windows_to_add.is_empty()
            && self.exercise_minutes_needed.is_none()
            && self.socialization_minutes_needed.is_none()
            && self.self_care_minutes_needed.is_none()
            && self.task_capacity_hours_per_day.is_none()
            && self.sleep_hours_needed.is_none()
            && self.downtime_hours_needed.is_none()
            && self.notes_to_add.is_empty()
    }

    fn touches_sensitive_fields(&self) -> bool {
        self.sensitive
            || self.user_name.is_some()
            || self.age.is_some()
            || !self.important_days_to_add.is_empty()
            || !self.limitations_to_add.is_empty()
            || self.exercise_minutes_needed.is_some()
            || self.socialization_minutes_needed.is_some()
            || self.self_care_minutes_needed.is_some()
            || self.sleep_hours_needed.is_some()
            || self.downtime_hours_needed.is_some()
            || !self.notes_to_add.is_empty()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistantMemoryUpdateStatus {
    NoUpdate,
    Applied,
    NoChanges,
    NeedsConsent,
    NeedsConfirmation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssistantMemoryUpdateResult {
    pub status: AssistantMemoryUpdateStatus,
    pub changed_fields: Vec<String>,
}

impl AssistantMemoryUpdateResult {
    fn no_update() -> Self {
        Self {
            status: AssistantMemoryUpdateStatus::NoUpdate,
            changed_fields: Vec::new(),
        }
    }

    fn with_status(status: AssistantMemoryUpdateStatus) -> Self {
        Self {
            status,
            changed_fields: Vec::new(),
        }
    }

    pub fn response_note(&self) -> Option<&'static str> {
        match self.status {
            AssistantMemoryUpdateStatus::Applied => Some("I saved that to Memory."),
            AssistantMemoryUpdateStatus::NeedsConsent => Some(
                "I did not write that to Memory because Assistant memory updates are turned off.",
            ),
            AssistantMemoryUpdateStatus::NeedsConfirmation => Some(
                "I did not write that sensitive detail to Memory because confirmation is required.",
            ),
            AssistantMemoryUpdateStatus::NoUpdate | AssistantMemoryUpdateStatus::NoChanges => None,
        }
    }
}

fn set_yaml<T: serde::Serialize>(
    fm: &mut markdown_parser::Frontmatter,
    key: &str,
    value: T,
) -> Result<(), AppError> {
    let value = serde_yaml::to_value(value).map_err(|err| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to serialize memory field '{key}': {err}"),
        )
    })?;
    fm.insert(key.to_string(), value);
    Ok(())
}

fn memory_time_window_value(window: &MemoryTimeWindow) -> serde_yaml::Value {
    let mut map = serde_yaml::Mapping::new();
    map.insert(
        "label".into(),
        serde_yaml::Value::String(window.label.clone()),
    );
    map.insert(
        "start_time".into(),
        serde_yaml::Value::String(window.start_time.clone()),
    );
    map.insert(
        "end_time".into(),
        serde_yaml::Value::String(window.end_time.clone()),
    );
    map.insert(
        "days".into(),
        serde_yaml::to_value(&window.days).unwrap_or_default(),
    );
    serde_yaml::Value::Mapping(map)
}

fn memory_important_day_value(day: &MemoryImportantDay) -> serde_yaml::Value {
    let mut map = serde_yaml::Mapping::new();
    map.insert("label".into(), serde_yaml::Value::String(day.label.clone()));
    map.insert("date".into(), serde_yaml::Value::String(day.date.clone()));
    if let Some(recurrence) = &day.recurrence {
        map.insert(
            "recurrence".into(),
            serde_yaml::Value::String(recurrence.clone()),
        );
    }
    if let Some(notes) = &day.notes {
        map.insert("notes".into(), serde_yaml::Value::String(notes.clone()));
    }
    serde_yaml::Value::Mapping(map)
}

fn memory_time_windows_value(windows: &[MemoryTimeWindow]) -> serde_yaml::Value {
    serde_yaml::Value::Sequence(windows.iter().map(memory_time_window_value).collect())
}

fn memory_consent_value(consent: &MemoryConsentInput) -> serde_yaml::Value {
    let mut map = serde_yaml::Mapping::new();
    map.insert("use_for_planning".into(), serde_yaml::Value::Bool(true));
    map.insert(
        "allow_ai_updates_from_chat".into(),
        serde_yaml::Value::Bool(consent.allow_ai_updates_from_chat),
    );
    map.insert(
        "allow_remote_ai_context".into(),
        serde_yaml::Value::Bool(consent.allow_remote_ai_context),
    );
    map.insert(
        "require_confirmation_for_sensitive_updates".into(),
        serde_yaml::Value::Bool(consent.require_confirmation_for_sensitive_updates),
    );
    serde_yaml::Value::Mapping(map)
}

fn yaml_mapping_value<'a>(
    map: &'a serde_yaml::Mapping,
    key: &str,
) -> Option<&'a serde_yaml::Value> {
    map.get(serde_yaml::Value::String(key.to_string()))
}

fn yaml_mapping_str(map: &serde_yaml::Mapping, key: &str) -> Option<String> {
    yaml_mapping_value(map, key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn yaml_mapping_bool(map: &serde_yaml::Mapping, snake_key: &str, camel_key: &str) -> Option<bool> {
    yaml_mapping_value(map, snake_key)
        .or_else(|| yaml_mapping_value(map, camel_key))
        .and_then(|value| value.as_bool())
}

fn memory_update_consent(fm: &markdown_parser::Frontmatter) -> (bool, bool) {
    let consent = fm.get("consent").and_then(|value| value.as_mapping());
    let allow_ai_updates_from_chat = consent
        .and_then(|map| {
            yaml_mapping_bool(map, "allow_ai_updates_from_chat", "allowAiUpdatesFromChat")
        })
        .unwrap_or(false);
    let require_confirmation_for_sensitive_updates = consent
        .and_then(|map| {
            yaml_mapping_bool(
                map,
                "require_confirmation_for_sensitive_updates",
                "requireConfirmationForSensitiveUpdates",
            )
        })
        .unwrap_or(true);

    (
        allow_ai_updates_from_chat,
        require_confirmation_for_sensitive_updates,
    )
}

fn set_yaml_if_changed<T: serde::Serialize>(
    fm: &mut markdown_parser::Frontmatter,
    key: &str,
    value: T,
) -> Result<bool, AppError> {
    let value = serde_yaml::to_value(value).map_err(|err| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to serialize memory field '{key}': {err}"),
        )
    })?;

    if fm.get(key) == Some(&value) {
        return Ok(false);
    }

    fm.insert(key.to_string(), value);
    Ok(true)
}

fn sequence_field_for_update(
    fm: &markdown_parser::Frontmatter,
    key: &str,
) -> Result<Vec<serde_yaml::Value>, String> {
    match fm.get(key) {
        None | Some(serde_yaml::Value::Null) => Ok(Vec::new()),
        Some(serde_yaml::Value::Sequence(seq)) => Ok(seq.clone()),
        Some(_) => Err(format!(
            "Memory field '{key}' must be a list before it can be updated"
        )),
    }
}

fn normalized_memory_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn append_string_memory_values(
    fm: &mut markdown_parser::Frontmatter,
    key: &str,
    values: &[String],
    changed_fields: &mut Vec<String>,
) -> Result<(), String> {
    if values.is_empty() {
        return Ok(());
    }

    let mut seq = sequence_field_for_update(fm, key)?;
    let mut existing = seq
        .iter()
        .filter_map(|value| value.as_str())
        .map(normalized_memory_key)
        .collect::<Vec<_>>();
    let mut changed = false;

    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = normalized_memory_key(trimmed);
        if existing.iter().any(|item| item == &normalized) {
            continue;
        }
        existing.push(normalized);
        seq.push(serde_yaml::Value::String(trimmed.to_string()));
        changed = true;
    }

    if changed {
        fm.insert(key.to_string(), serde_yaml::Value::Sequence(seq));
        changed_fields.push(key.to_string());
    }

    Ok(())
}

fn important_day_key(value: &serde_yaml::Value) -> Option<String> {
    let map = value.as_mapping()?;
    let label = yaml_mapping_str(map, "label")?;
    let date = yaml_mapping_str(map, "date")?;
    Some(format!(
        "{}|{}",
        normalized_memory_key(&label),
        normalized_memory_key(&date)
    ))
}

fn append_important_days(
    fm: &mut markdown_parser::Frontmatter,
    days: &[MemoryImportantDay],
    changed_fields: &mut Vec<String>,
) -> Result<(), String> {
    if days.is_empty() {
        return Ok(());
    }

    let mut seq = sequence_field_for_update(fm, "important_days")?;
    let mut existing = seq.iter().filter_map(important_day_key).collect::<Vec<_>>();
    let mut changed = false;

    for day in days {
        if day.label.trim().is_empty() || day.date.trim().is_empty() {
            continue;
        }
        let key = format!(
            "{}|{}",
            normalized_memory_key(&day.label),
            normalized_memory_key(&day.date)
        );
        if existing.iter().any(|item| item == &key) {
            continue;
        }
        existing.push(key);
        seq.push(memory_important_day_value(day));
        changed = true;
    }

    if changed {
        fm.insert("important_days".into(), serde_yaml::Value::Sequence(seq));
        changed_fields.push("important_days".to_string());
    }

    Ok(())
}

fn time_window_key(value: &serde_yaml::Value) -> Option<String> {
    let map = value.as_mapping()?;
    let label = yaml_mapping_str(map, "label")?;
    let start =
        yaml_mapping_str(map, "start_time").or_else(|| yaml_mapping_str(map, "startTime"))?;
    let end = yaml_mapping_str(map, "end_time").or_else(|| yaml_mapping_str(map, "endTime"))?;
    Some(format!(
        "{}|{}|{}",
        normalized_memory_key(&label),
        normalized_memory_key(&start),
        normalized_memory_key(&end)
    ))
}

fn append_time_windows(
    fm: &mut markdown_parser::Frontmatter,
    key: &str,
    windows: &[MemoryTimeWindow],
    changed_fields: &mut Vec<String>,
) -> Result<(), String> {
    if windows.is_empty() {
        return Ok(());
    }

    let mut seq = sequence_field_for_update(fm, key)?;
    let mut existing = seq.iter().filter_map(time_window_key).collect::<Vec<_>>();
    let mut changed = false;

    for window in windows {
        if window.label.trim().is_empty()
            || window.start_time.trim().is_empty()
            || window.end_time.trim().is_empty()
        {
            continue;
        }
        let window_key = format!(
            "{}|{}|{}",
            normalized_memory_key(&window.label),
            normalized_memory_key(&window.start_time),
            normalized_memory_key(&window.end_time)
        );
        if existing.iter().any(|item| item == &window_key) {
            continue;
        }
        existing.push(window_key);
        seq.push(memory_time_window_value(window));
        changed = true;
    }

    if changed {
        fm.insert(key.to_string(), serde_yaml::Value::Sequence(seq));
        changed_fields.push(key.to_string());
    }

    Ok(())
}

fn append_memory_ai_note(
    body: &str,
    timestamp: &str,
    changed_fields: &[String],
    reason: Option<&str>,
    notes: &[String],
) -> String {
    let mut body = body.trim_end().to_string();
    if !body.lines().any(|line| line.trim() == "## AI Notes") {
        if !body.is_empty() {
            body.push_str("\n\n");
        }
        body.push_str("## AI Notes\n");
    }

    let fields = if changed_fields.is_empty() {
        "metadata".to_string()
    } else {
        changed_fields.join(", ")
    };
    body.push_str(&format!(
        "\n- {timestamp}: Assistant updated Memory from chat. Fields: {fields}."
    ));
    if let Some(reason) = reason.map(str::trim).filter(|reason| !reason.is_empty()) {
        body.push_str(&format!(" Source: {reason}."));
    }
    body.push('\n');
    for note in notes {
        let note = note.trim();
        if !note.is_empty() {
            body.push_str(&format!("  - {note}\n"));
        }
    }
    body
}

fn unique_memory_notes(body: &str, notes: &[String]) -> Vec<String> {
    let existing = body.to_ascii_lowercase();
    let mut seen = Vec::new();
    let mut unique = Vec::new();

    for note in notes {
        let note = note.trim();
        if note.is_empty() {
            continue;
        }
        let normalized = normalized_memory_key(note);
        if normalized.is_empty()
            || existing.contains(&normalized)
            || seen.iter().any(|item| item == &normalized)
        {
            continue;
        }
        seen.push(normalized);
        unique.push(note.to_string());
    }

    unique
}

pub(crate) fn apply_assistant_memory_update(
    vault_id: &str,
    state: &AppState,
    update: &AssistantMemoryUpdate,
) -> Result<AssistantMemoryUpdateResult, AppError> {
    if update.is_empty() {
        return Ok(AssistantMemoryUpdateResult::no_update());
    }

    let vaults = state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    apply_assistant_memory_update_for_vault(vault, update)
}

fn apply_assistant_memory_update_for_vault(
    vault: &VaultManager,
    update: &AssistantMemoryUpdate,
) -> Result<AssistantMemoryUpdateResult, AppError> {
    if update.is_empty() {
        return Ok(AssistantMemoryUpdateResult::no_update());
    }

    vault.ensure_v1_markdown_structure()?;
    let memory_path = vault.structure().memory_file();
    let content = std::fs::read_to_string(&memory_path)?;
    let (mut fm, body) = match markdown_parser::parse_frontmatter(&content) {
        Ok((frontmatter, body)) => (frontmatter, body),
        Err(markdown_parser::ParseError::MissingDelimiter) => {
            (markdown_parser::Frontmatter::new(), content)
        }
        Err(err) => {
            let message = format!("Markdown parse error: {err}");
            vault.log_vault_error(&memory_path, &message)?;
            return Err(AppError::validation_error(message));
        }
    };

    let (allow_ai_updates_from_chat, require_sensitive_confirmation) = memory_update_consent(&fm);
    if !allow_ai_updates_from_chat {
        return Ok(AssistantMemoryUpdateResult::with_status(
            AssistantMemoryUpdateStatus::NeedsConsent,
        ));
    }
    if require_sensitive_confirmation
        && update.touches_sensitive_fields()
        && !update.confirmed_by_user
    {
        return Ok(AssistantMemoryUpdateResult::with_status(
            AssistantMemoryUpdateStatus::NeedsConfirmation,
        ));
    }

    let mut changed_fields = Vec::new();

    if set_yaml_if_changed(&mut fm, "id", "memory_local_user")? {
        changed_fields.push("id".to_string());
    }
    if set_yaml_if_changed(&mut fm, "type", "memory")? {
        changed_fields.push("type".to_string());
    }
    if let Some(user_name) = update
        .user_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if set_yaml_if_changed(&mut fm, "user_name", user_name)? {
            changed_fields.push("user_name".to_string());
        }
    }
    if let Some(age) = update.age {
        if set_yaml_if_changed(&mut fm, "age", age)? {
            changed_fields.push("age".to_string());
        }
    }

    append_important_days(&mut fm, &update.important_days_to_add, &mut changed_fields).map_err(
        |message| {
            let _ = vault.log_vault_error(&memory_path, &message);
            AppError::validation_error(message)
        },
    )?;
    append_string_memory_values(&mut fm, "likes", &update.likes_to_add, &mut changed_fields)
        .map_err(|message| {
            let _ = vault.log_vault_error(&memory_path, &message);
            AppError::validation_error(message)
        })?;
    append_string_memory_values(
        &mut fm,
        "dislikes",
        &update.dislikes_to_add,
        &mut changed_fields,
    )
    .map_err(|message| {
        let _ = vault.log_vault_error(&memory_path, &message);
        AppError::validation_error(message)
    })?;
    append_string_memory_values(
        &mut fm,
        "limitations",
        &update.limitations_to_add,
        &mut changed_fields,
    )
    .map_err(|message| {
        let _ = vault.log_vault_error(&memory_path, &message);
        AppError::validation_error(message)
    })?;
    append_time_windows(
        &mut fm,
        "meal_windows",
        &update.meal_windows_to_add,
        &mut changed_fields,
    )
    .map_err(|message| {
        let _ = vault.log_vault_error(&memory_path, &message);
        AppError::validation_error(message)
    })?;
    append_time_windows(
        &mut fm,
        "snack_windows",
        &update.snack_windows_to_add,
        &mut changed_fields,
    )
    .map_err(|message| {
        let _ = vault.log_vault_error(&memory_path, &message);
        AppError::validation_error(message)
    })?;

    for (key, value) in [
        ("exercise_minutes_needed", update.exercise_minutes_needed),
        (
            "socialization_minutes_needed",
            update.socialization_minutes_needed,
        ),
        ("self_care_minutes_needed", update.self_care_minutes_needed),
    ] {
        if let Some(value) = value {
            if set_yaml_if_changed(&mut fm, key, value)? {
                changed_fields.push(key.to_string());
            }
        }
    }
    for (key, value) in [
        (
            "task_capacity_hours_per_day",
            update.task_capacity_hours_per_day,
        ),
        ("sleep_hours_needed", update.sleep_hours_needed),
        ("downtime_hours_needed", update.downtime_hours_needed),
    ] {
        if let Some(value) = value {
            if set_yaml_if_changed(&mut fm, key, value)? {
                changed_fields.push(key.to_string());
            }
        }
    }
    let notes_to_add = unique_memory_notes(&body, &update.notes_to_add);
    if !notes_to_add.is_empty() {
        changed_fields.push("ai_notes".to_string());
    }

    if changed_fields.is_empty() {
        return Ok(AssistantMemoryUpdateResult::with_status(
            AssistantMemoryUpdateStatus::NoChanges,
        ));
    }

    let timestamp = Utc::now().to_rfc3339();
    set_yaml(&mut fm, "last_updated", timestamp.clone())?;
    let body = append_memory_ai_note(
        &body,
        &timestamp,
        &changed_fields,
        update.reason.as_deref(),
        &notes_to_add,
    );
    let content = markdown_parser::serialize_frontmatter(&fm, &body);
    vault.write_markdown_file(
        &memory_path,
        &content,
        "assistant",
        "assistant_chat_update_memory",
        Some("memory_local_user"),
    )?;

    Ok(AssistantMemoryUpdateResult {
        status: AssistantMemoryUpdateStatus::Applied,
        changed_fields,
    })
}

fn format_windows(label: &str, windows: &[MemoryTimeWindow], body: &mut String) {
    if windows.is_empty() {
        return;
    }
    body.push_str(&format!("- {label}:\n"));
    for window in windows {
        let days = if window.days.is_empty() {
            "every day".to_string()
        } else {
            window.days.join(", ")
        };
        body.push_str(&format!(
            "  - {}: {}-{} ({days})\n",
            window.label, window.start_time, window.end_time
        ));
    }
}

fn memory_body(input: &MemoryInput) -> String {
    let mut body = String::new();
    body.push_str("## About Me\n\n");
    if !input.user_name.trim().is_empty() {
        body.push_str(&format!("- Name: {}\n", input.user_name.trim()));
    }
    if let Some(age) = input.age {
        body.push_str(&format!("- Age: {age}\n"));
    }

    body.push_str("\n## Schedule and Capacity\n\n");
    if let Some(hours) = input.task_capacity_hours_per_day {
        body.push_str(&format!("- Task capacity: {hours} hours/day\n"));
    }
    if let Some(hours) = input.sleep_hours_needed {
        body.push_str(&format!("- Sleep needed: {hours} hours\n"));
    }
    if let Some(hours) = input.downtime_hours_needed {
        body.push_str(&format!("- Downtime needed: {hours} hours\n"));
    }
    format_windows("Meals", &input.meal_windows, &mut body);
    format_windows("Snacks", &input.snack_windows, &mut body);
    if let Some(minutes) = input.exercise_minutes_needed {
        body.push_str(&format!("- Exercise: {minutes} minutes/day\n"));
    }
    if let Some(minutes) = input.socialization_minutes_needed {
        body.push_str(&format!("- Socialization: {minutes} minutes/day\n"));
    }
    if let Some(minutes) = input.self_care_minutes_needed {
        body.push_str(&format!("- Self-care: {minutes} minutes/day\n"));
    }

    body.push_str("\n## Preferences\n\n");
    for item in &input.likes {
        body.push_str(&format!("- Likes: {item}\n"));
    }
    for item in &input.dislikes {
        body.push_str(&format!("- Dislikes: {item}\n"));
    }

    body.push_str("\n## Limitations\n\n");
    for item in &input.limitations {
        body.push_str(&format!("- {item}\n"));
    }

    body.push_str("\n## Important Days\n\n");
    for day in &input.important_days {
        body.push_str(&format!("- {}: {}", day.label, day.date));
        if let Some(recurrence) = &day.recurrence {
            body.push_str(&format!(" ({recurrence})"));
        }
        if let Some(notes) = &day.notes {
            if !notes.trim().is_empty() {
                body.push_str(&format!(" - {}", notes.trim()));
            }
        }
        body.push('\n');
    }

    body.push_str("\n## AI Notes\n\n");
    body.push_str("- Memory collected during onboarding.\n");
    body
}

#[tauri::command]
pub async fn save_memory(
    vault_id: String,
    input: MemoryInput,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    save_memory_for_state(&vault_id, input, state.inner())
}

fn save_memory_for_state(
    vault_id: &str,
    input: MemoryInput,
    state: &AppState,
) -> Result<(), AppError> {
    let vaults = state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    save_memory_for_vault(vault, input)
}

fn save_memory_for_vault(vault: &VaultManager, input: MemoryInput) -> Result<(), AppError> {
    vault.ensure_v1_markdown_structure()?;

    let memory_path = vault.structure().memory_file();
    let mut fm = if memory_path.exists() {
        let content = std::fs::read_to_string(&memory_path)?;
        match markdown_parser::parse_frontmatter(&content) {
            Ok((frontmatter, _body)) => frontmatter,
            Err(markdown_parser::ParseError::MissingDelimiter) => {
                markdown_parser::Frontmatter::new()
            }
            Err(err) => {
                let message = format!("Markdown parse error: {err}");
                vault.log_vault_error(&memory_path, &message)?;
                return Err(AppError::validation_error(message));
            }
        }
    } else {
        markdown_parser::Frontmatter::new()
    };

    set_yaml(&mut fm, "id", "memory_local_user")?;
    set_yaml(&mut fm, "type", "memory")?;
    set_yaml(&mut fm, "user_name", input.user_name.trim())?;
    set_yaml(&mut fm, "age", input.age)?;
    set_yaml(&mut fm, "important_days", &input.important_days)?;
    set_yaml(&mut fm, "likes", &input.likes)?;
    set_yaml(&mut fm, "dislikes", &input.dislikes)?;
    set_yaml(&mut fm, "limitations", &input.limitations)?;
    fm.insert(
        "meal_windows".into(),
        memory_time_windows_value(&input.meal_windows),
    );
    fm.insert(
        "snack_windows".into(),
        memory_time_windows_value(&input.snack_windows),
    );
    set_yaml(
        &mut fm,
        "exercise_minutes_needed",
        input.exercise_minutes_needed,
    )?;
    set_yaml(
        &mut fm,
        "socialization_minutes_needed",
        input.socialization_minutes_needed,
    )?;
    set_yaml(
        &mut fm,
        "self_care_minutes_needed",
        input.self_care_minutes_needed,
    )?;
    set_yaml(
        &mut fm,
        "task_capacity_hours_per_day",
        input.task_capacity_hours_per_day,
    )?;
    set_yaml(&mut fm, "sleep_hours_needed", input.sleep_hours_needed)?;
    set_yaml(
        &mut fm,
        "downtime_hours_needed",
        input.downtime_hours_needed,
    )?;
    fm.insert("consent".into(), memory_consent_value(&input.consent));
    set_yaml(&mut fm, "last_updated", Utc::now().to_rfc3339())?;

    let content = markdown_parser::serialize_frontmatter(&fm, &memory_body(&input));
    vault.write_markdown_file(
        &memory_path,
        &content,
        "user",
        "write_memory",
        Some("memory_local_user"),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn memory_input() -> MemoryInput {
        MemoryInput {
            user_name: "Avery".to_string(),
            age: None,
            important_days: Vec::new(),
            likes: vec!["morning planning".to_string()],
            dislikes: Vec::new(),
            limitations: Vec::new(),
            meal_windows: Vec::new(),
            snack_windows: Vec::new(),
            exercise_minutes_needed: Some(30),
            socialization_minutes_needed: None,
            self_care_minutes_needed: None,
            task_capacity_hours_per_day: Some(4.5),
            sleep_hours_needed: None,
            downtime_hours_needed: None,
            consent: MemoryConsentInput {
                use_for_planning: true,
                allow_ai_updates_from_chat: false,
                allow_remote_ai_context: true,
                require_confirmation_for_sensitive_updates: true,
            },
        }
    }

    #[test]
    fn save_memory_rejects_invalid_existing_frontmatter_without_overwrite() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("memory-invalid-frontmatter");
        let manager =
            VaultManager::create("Memory Test", &vault_path, vault_core::VaultType::Private)
                .unwrap();
        let memory_path = manager.structure().memory_file();
        let invalid_content = "---\nid: [\n---\n\n## User notes\nDo not lose this.\n";
        std::fs::write(&memory_path, invalid_content).unwrap();

        let error = save_memory_for_vault(&manager, memory_input()).unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("Markdown parse error"));
        assert_eq!(
            std::fs::read_to_string(&memory_path).unwrap(),
            invalid_content
        );
        assert!(
            !manager.structure().mutation_log.exists()
                || !std::fs::read_to_string(&manager.structure().mutation_log)
                    .unwrap()
                    .contains("write_memory")
        );
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("memory.md"));
        assert!(error_log.contains("Markdown parse error"));
    }

    #[test]
    fn assistant_memory_update_writes_consented_non_sensitive_fields_with_audit() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("memory-assistant-update");
        let manager =
            VaultManager::create("Memory Test", &vault_path, vault_core::VaultType::Private)
                .unwrap();
        let mut input = memory_input();
        input.consent.allow_ai_updates_from_chat = true;
        save_memory_for_vault(&manager, input).unwrap();

        let update = AssistantMemoryUpdate {
            reason: Some("user said this in chat".to_string()),
            likes_to_add: vec!["focused work before noon".to_string()],
            task_capacity_hours_per_day: Some(5.0),
            ..AssistantMemoryUpdate::default()
        };

        let result = apply_assistant_memory_update_for_vault(&manager, &update).unwrap();

        assert_eq!(result.status, AssistantMemoryUpdateStatus::Applied);
        assert!(result.changed_fields.contains(&"likes".to_string()));
        assert!(result
            .changed_fields
            .contains(&"task_capacity_hours_per_day".to_string()));

        let content = std::fs::read_to_string(manager.structure().memory_file()).unwrap();
        let (frontmatter, body) = markdown_parser::parse_frontmatter(&content).unwrap();
        let likes = frontmatter
            .get("likes")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert!(likes
            .iter()
            .any(|value| value.as_str() == Some("focused work before noon")));
        assert_eq!(
            frontmatter
                .get("task_capacity_hours_per_day")
                .and_then(|value| value.as_f64()),
            Some(5.0)
        );
        assert!(body.contains("Assistant updated Memory from chat"));

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_chat_update_memory"));
        assert!(mutation_log.contains("- File: `memory.md`"));
        assert!(mutation_log.contains("- Entity: `memory_local_user`"));
    }

    #[test]
    fn assistant_memory_update_writes_consented_notes_with_audit() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("memory-assistant-note");
        let manager =
            VaultManager::create("Memory Test", &vault_path, vault_core::VaultType::Private)
                .unwrap();
        let mut input = memory_input();
        input.consent.allow_ai_updates_from_chat = true;
        save_memory_for_vault(&manager, input).unwrap();

        let update = AssistantMemoryUpdate {
            reason: Some("user asked Assistant to remember this".to_string()),
            confirmed_by_user: true,
            notes_to_add: vec!["Email drains focus after 4 PM".to_string()],
            ..AssistantMemoryUpdate::default()
        };

        let result = apply_assistant_memory_update_for_vault(&manager, &update).unwrap();

        assert_eq!(result.status, AssistantMemoryUpdateStatus::Applied);
        assert!(result.changed_fields.contains(&"ai_notes".to_string()));

        let content = std::fs::read_to_string(manager.structure().memory_file()).unwrap();
        let (_frontmatter, body) = markdown_parser::parse_frontmatter(&content).unwrap();
        assert!(body.contains("Fields: ai_notes"));
        assert!(body.contains("Email drains focus after 4 PM"));

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_chat_update_memory"));
        assert!(mutation_log.contains("- File: `memory.md`"));
    }

    #[test]
    fn assistant_memory_update_requires_confirmation_for_sensitive_fields() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("memory-sensitive-update");
        let manager =
            VaultManager::create("Memory Test", &vault_path, vault_core::VaultType::Private)
                .unwrap();
        let mut input = memory_input();
        input.consent.allow_ai_updates_from_chat = true;
        input.consent.require_confirmation_for_sensitive_updates = true;
        save_memory_for_vault(&manager, input).unwrap();
        let before = std::fs::read_to_string(manager.structure().memory_file()).unwrap();

        let update = AssistantMemoryUpdate {
            limitations_to_add: vec!["avoid late-night high-energy tasks".to_string()],
            ..AssistantMemoryUpdate::default()
        };

        let result = apply_assistant_memory_update_for_vault(&manager, &update).unwrap();

        assert_eq!(
            result.status,
            AssistantMemoryUpdateStatus::NeedsConfirmation
        );
        assert_eq!(
            std::fs::read_to_string(manager.structure().memory_file()).unwrap(),
            before
        );
        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(!mutation_log.contains("assistant_chat_update_memory"));
    }

    #[test]
    fn assistant_memory_update_writes_confirmed_sensitive_fields() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("memory-confirmed-sensitive-update");
        let manager =
            VaultManager::create("Memory Test", &vault_path, vault_core::VaultType::Private)
                .unwrap();
        let mut input = memory_input();
        input.consent.allow_ai_updates_from_chat = true;
        input.consent.require_confirmation_for_sensitive_updates = true;
        save_memory_for_vault(&manager, input).unwrap();

        let update = AssistantMemoryUpdate {
            confirmed_by_user: true,
            limitations_to_add: vec!["avoid late-night high-energy tasks".to_string()],
            ..AssistantMemoryUpdate::default()
        };

        let result = apply_assistant_memory_update_for_vault(&manager, &update).unwrap();

        assert_eq!(result.status, AssistantMemoryUpdateStatus::Applied);
        let content = std::fs::read_to_string(manager.structure().memory_file()).unwrap();
        let (frontmatter, _body) = markdown_parser::parse_frontmatter(&content).unwrap();
        let limitations = frontmatter
            .get("limitations")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert!(limitations
            .iter()
            .any(|value| value.as_str() == Some("avoid late-night high-energy tasks")));
    }
}
