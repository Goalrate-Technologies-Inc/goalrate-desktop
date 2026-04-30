//! File system watcher for vault changes

use std::path::Path;
use std::sync::mpsc::{channel, Receiver, TryRecvError};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::{VaultError, VaultResult};

/// Event types for vault file changes
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultEvent {
    /// A goal was created
    GoalCreated(String),
    /// A goal was modified
    GoalModified(String),
    /// A goal was deleted
    GoalDeleted(String),
    /// A goal task was created
    GoalTaskCreated { goal_id: String, task_id: String },
    /// A goal task was modified
    GoalTaskModified { goal_id: String, task_id: String },
    /// A goal task was deleted
    GoalTaskDeleted { goal_id: String, task_id: String },
    /// A focus file was modified
    FocusModified(String),
    /// The vault config was modified
    ConfigModified,
    /// Unknown event
    Unknown(String),
}

/// Watcher for vault file system changes
pub struct VaultWatcher {
    _watcher: RecommendedWatcher,
    receiver: Receiver<Result<Event, notify::Error>>,
}

fn read_goal_id_from_goal_file(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|content| markdown_parser::parse_frontmatter(&content).ok())
        .and_then(|(fm, _)| fm.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

impl VaultWatcher {
    /// Create a new watcher for a vault path
    pub fn new(vault_path: impl AsRef<Path>) -> VaultResult<Self> {
        let (tx, rx) = channel();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        )?;

        watcher.watch(vault_path.as_ref(), RecursiveMode::Recursive)?;

        Ok(Self {
            _watcher: watcher,
            receiver: rx,
        })
    }

    /// Poll for the next event (non-blocking)
    pub fn poll(&self) -> Option<VaultResult<VaultEvent>> {
        match self.receiver.try_recv() {
            Ok(Ok(event)) => Some(self.classify_event(event)),
            Ok(Err(e)) => Some(Err(VaultError::Watcher(e))),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => None,
        }
    }

    /// Blocking wait for the next event
    pub fn wait(&self) -> VaultResult<VaultEvent> {
        match self.receiver.recv() {
            Ok(Ok(event)) => self.classify_event(event),
            Ok(Err(e)) => Err(VaultError::Watcher(e)),
            Err(_) => Err(VaultError::InvalidPath("Watcher disconnected".into())),
        }
    }

    /// Classify a notify event into a VaultEvent
    fn classify_event(&self, event: Event) -> VaultResult<VaultEvent> {
        let path = event
            .paths
            .first()
            .ok_or_else(|| VaultError::InvalidPath("Event has no path".into()))?;

        let path_str = path.to_string_lossy();
        let is_create = matches!(event.kind, EventKind::Create(_));
        let is_remove = matches!(event.kind, EventKind::Remove(_));

        // Parse the path to determine event type
        if path_str.ends_with(".vault.json") {
            return Ok(VaultEvent::ConfigModified);
        }

        // Focus files
        if path_str.contains("/focus/") && path_str.ends_with(".md") {
            if let Some(filename) = path.file_stem() {
                return Ok(VaultEvent::FocusModified(filename.to_string_lossy().into()));
            }
        }

        // Goal files
        if path_str.contains("/goals/") {
            // Goal main file
            if path_str.ends_with("/goal.md") {
                let parts: Vec<&str> = path_str.split("/goals/").collect();
                if parts.len() > 1 {
                    let goal_id = read_goal_id_from_goal_file(path)
                        .unwrap_or_else(|| parts[1].trim_end_matches("/goal.md").to_string());
                    return Ok(if is_create {
                        VaultEvent::GoalCreated(goal_id)
                    } else if is_remove {
                        VaultEvent::GoalDeleted(goal_id)
                    } else {
                        VaultEvent::GoalModified(goal_id)
                    });
                }
            }

            if path_str.ends_with(".md") {
                let parts: Vec<&str> = path_str.split("/goals/").collect();
                if parts.len() > 1 {
                    let subpath = parts[1];
                    if !subpath.contains('/') {
                        let goal_id = read_goal_id_from_goal_file(path)
                            .unwrap_or_else(|| subpath.trim_end_matches(".md").to_string());
                        return Ok(if is_create {
                            VaultEvent::GoalCreated(goal_id)
                        } else if is_remove {
                            VaultEvent::GoalDeleted(goal_id)
                        } else {
                            VaultEvent::GoalModified(goal_id)
                        });
                    }
                }
            }
        }

        // Unknown event
        Ok(VaultEvent::Unknown(path_str.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};

    fn make_event(path: &str, kind: EventKind) -> Event {
        Event {
            kind,
            paths: vec![path.into()],
            attrs: Default::default(),
        }
    }

    #[test]
    fn test_classify_config_event() {
        let event = make_event("/vault/.vault.json", EventKind::Modify(ModifyKind::Any));
        let watcher_event = VaultWatcher::classify_event_standalone(&event).unwrap();
        assert_eq!(watcher_event, VaultEvent::ConfigModified);
    }

    #[test]
    fn test_classify_goal_created() {
        let event = make_event(
            "/vault/goals/my-goal/goal.md",
            EventKind::Create(CreateKind::File),
        );
        let watcher_event = VaultWatcher::classify_event_standalone(&event).unwrap();
        assert_eq!(watcher_event, VaultEvent::GoalCreated("my-goal".into()));
    }

    #[test]
    fn test_classify_goal_created_flat() {
        let event = make_event(
            "/vault/goals/my-goal.md",
            EventKind::Create(CreateKind::File),
        );
        let watcher_event = VaultWatcher::classify_event_standalone(&event).unwrap();
        assert_eq!(watcher_event, VaultEvent::GoalCreated("my-goal".into()));
    }

    #[test]
    fn test_classify_focus_modified() {
        let event = make_event(
            "/vault/focus/2024-01-15.md",
            EventKind::Modify(ModifyKind::Any),
        );
        let watcher_event = VaultWatcher::classify_event_standalone(&event).unwrap();
        assert_eq!(
            watcher_event,
            VaultEvent::FocusModified("2024-01-15".into())
        );
    }

    #[test]
    fn test_classify_project_markdown_as_unknown_for_desktop_mvp() {
        let event = make_event(
            "/vault/projects/my-project/project.md",
            EventKind::Remove(RemoveKind::File),
        );
        let watcher_event = VaultWatcher::classify_event_standalone(&event).unwrap();
        assert_eq!(
            watcher_event,
            VaultEvent::Unknown("/vault/projects/my-project/project.md".into())
        );
    }

    impl VaultWatcher {
        // Helper for testing without creating actual watcher
        fn classify_event_standalone(event: &Event) -> VaultResult<VaultEvent> {
            let path = event
                .paths
                .first()
                .ok_or_else(|| VaultError::InvalidPath("Event has no path".into()))?;

            let path_str = path.to_string_lossy();
            let is_create = matches!(event.kind, EventKind::Create(_));
            let is_remove = matches!(event.kind, EventKind::Remove(_));

            if path_str.ends_with(".vault.json") {
                return Ok(VaultEvent::ConfigModified);
            }

            if path_str.contains("/focus/") && path_str.ends_with(".md") {
                if let Some(filename) = path.file_stem() {
                    return Ok(VaultEvent::FocusModified(filename.to_string_lossy().into()));
                }
            }

            if path_str.contains("/goals/") {
                if path_str.ends_with("/goal.md") {
                    let parts: Vec<&str> = path_str.split("/goals/").collect();
                    if parts.len() > 1 {
                        let goal_id = read_goal_id_from_goal_file(path)
                            .unwrap_or_else(|| parts[1].trim_end_matches("/goal.md").to_string());
                        return Ok(if is_create {
                            VaultEvent::GoalCreated(goal_id)
                        } else if is_remove {
                            VaultEvent::GoalDeleted(goal_id)
                        } else {
                            VaultEvent::GoalModified(goal_id)
                        });
                    }
                }

                if path_str.ends_with(".md")
                    && !path_str.contains("/tasks/")
                    && !path_str.contains("/milestones/")
                {
                    let parts: Vec<&str> = path_str.split("/goals/").collect();
                    if parts.len() > 1 {
                        let subpath = parts[1];
                        if !subpath.contains('/') {
                            let goal_id = read_goal_id_from_goal_file(path)
                                .unwrap_or_else(|| subpath.trim_end_matches(".md").to_string());
                            return Ok(if is_create {
                                VaultEvent::GoalCreated(goal_id)
                            } else if is_remove {
                                VaultEvent::GoalDeleted(goal_id)
                            } else {
                                VaultEvent::GoalModified(goal_id)
                            });
                        }
                    }
                }
            }

            Ok(VaultEvent::Unknown(path_str.into()))
        }
    }
}
