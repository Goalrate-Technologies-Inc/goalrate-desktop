//! Vault manager implementation

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::{VaultConfig, VaultError, VaultResult, VaultType};

/// Directory structure within a vault
#[derive(Debug, Clone)]
pub struct VaultStructure {
    /// Root vault directory
    pub root: PathBuf,
    /// Goals directory
    pub goals: PathBuf,
    /// Projects directory
    pub projects: PathBuf,
    /// Focus files directory
    pub focus: PathBuf,
    /// SQLite index file
    pub index: PathBuf,
    /// Vault config file
    pub config: PathBuf,
    /// Internal goalrate directory
    pub goalrate_dir: PathBuf,
}

impl VaultStructure {
    /// Create a new vault structure for a path
    pub fn new(root: impl AsRef<Path>) -> Self {
        let root = root.as_ref().to_path_buf();
        let goalrate_dir = root.join(".goalrate");

        Self {
            goals: root.join("goals"),
            projects: root.join("projects"),
            focus: root.join("focus"),
            index: goalrate_dir.join("index.db"),
            config: root.join(".vault.json"),
            goalrate_dir,
            root,
        }
    }

    /// Check if the vault structure is valid
    pub fn is_valid(&self) -> bool {
        self.config.exists()
    }

    /// Get the path for a specific goal
    pub fn goal_path(&self, goal_id: &str) -> PathBuf {
        self.goals.join(goal_id)
    }

    /// Get the path for a goal's main file (legacy directory layout)
    pub fn goal_file(&self, goal_id: &str) -> PathBuf {
        self.goal_path(goal_id).join("goal.md")
    }

    /// Get the path for a goal's root-level file
    pub fn goal_file_flat(&self, goal_id: &str) -> PathBuf {
        self.goals.join(format!("{}.md", goal_id))
    }

    /// Get the path for a goal's milestones directory (legacy directory layout)
    pub fn goal_tasks_path(&self, goal_id: &str) -> PathBuf {
        self.goal_path(goal_id).join("milestones")
    }

    /// Get the path for a specific project
    pub fn project_path(&self, project_id: &str) -> PathBuf {
        self.projects.join(project_id)
    }

    /// Get the path for a project's main file
    pub fn project_file(&self, project_id: &str) -> PathBuf {
        self.project_path(project_id).join("project.md")
    }

    /// Get the path for a project's tasks directory
    pub fn project_tasks_path(&self, project_id: &str) -> PathBuf {
        self.project_path(project_id).join("tasks")
    }

    /// Get the path for a focus file by date
    pub fn focus_file(&self, date: &str) -> PathBuf {
        self.focus.join(format!("{}.md", date))
    }
}

enum GoalLocation {
    Directory(PathBuf),
    Flat(PathBuf),
}

/// Manager for vault operations
pub struct VaultManager {
    structure: VaultStructure,
    config: VaultConfig,
}

impl VaultManager {
    fn goal_id_from_frontmatter_path(&self, path: &Path) -> Option<String> {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|content| markdown_parser::parse_frontmatter(&content).ok())
            .and_then(|(fm, _)| fm.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }

    fn find_goal_location(&self, goal_id: &str) -> VaultResult<Option<GoalLocation>> {
        let dir_path = self.structure.goal_path(goal_id);
        if dir_path.join("goal.md").exists() {
            return Ok(Some(GoalLocation::Directory(dir_path)));
        }

        let flat_path = self.structure.goal_file_flat(goal_id);
        if flat_path.exists() {
            return Ok(Some(GoalLocation::Flat(flat_path)));
        }

        if !self.structure.goals.exists() {
            return Ok(None);
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let goal_dir = entry.path();
            let goal_file = goal_dir.join("goal.md");
            if !goal_file.exists() {
                continue;
            }
            if self
                .goal_id_from_frontmatter_path(&goal_file)
                .map(|id| id == goal_id)
                .unwrap_or(false)
            {
                return Ok(Some(GoalLocation::Directory(goal_dir)));
            }
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            if self
                .goal_id_from_frontmatter_path(&path)
                .map(|id| id == goal_id)
                .unwrap_or(false)
            {
                return Ok(Some(GoalLocation::Flat(path)));
            }
        }

        Ok(None)
    }

    /// Open an existing vault
    pub fn open(path: impl AsRef<Path>) -> VaultResult<Self> {
        let path = path.as_ref();
        let structure = VaultStructure::new(path);

        if !structure.config.exists() {
            return Err(VaultError::InvalidStructure(
                "Missing .vault.json config file".into(),
            ));
        }

        let config_content = std::fs::read_to_string(&structure.config)?;
        let mut config: VaultConfig = serde_json::from_str(&config_content)?;

        // Update last opened timestamp
        config.touch();

        // Save the updated config
        let updated_content = serde_json::to_string_pretty(&config)?;
        std::fs::write(&structure.config, updated_content)?;

        let manager = Self { structure, config };
        manager.migrate_goals_to_flat()?;
        Ok(manager)
    }

    /// Create a new vault
    pub fn create(
        name: impl Into<String>,
        path: impl AsRef<Path>,
        vault_type: VaultType,
    ) -> VaultResult<Self> {
        let path = path.as_ref();
        let structure = VaultStructure::new(path);

        if structure.config.exists() {
            return Err(VaultError::AlreadyExists(path.display().to_string()));
        }

        // Create directory structure
        std::fs::create_dir_all(&structure.root)?;
        std::fs::create_dir_all(&structure.goalrate_dir)?;

        // Create config
        let config = VaultConfig::new(name, path.display().to_string(), vault_type);
        let config_content = serde_json::to_string_pretty(&config)?;
        std::fs::write(&structure.config, config_content)?;

        // Create .gitignore for .goalrate directory
        let gitignore_path = structure.goalrate_dir.join(".gitignore");
        std::fs::write(
            &gitignore_path,
            "# Ignore local index\nindex.db\nindex.db-*\n",
        )?;

        Ok(Self { structure, config })
    }

    /// Get vault configuration
    pub fn config(&self) -> &VaultConfig {
        &self.config
    }

    /// Get mutable vault configuration
    pub fn config_mut(&mut self) -> &mut VaultConfig {
        &mut self.config
    }

    /// Get vault structure
    pub fn structure(&self) -> &VaultStructure {
        &self.structure
    }

    /// Save the current configuration to disk
    pub fn save_config(&self) -> VaultResult<()> {
        let config_content = serde_json::to_string_pretty(&self.config)?;
        std::fs::write(&self.structure.config, config_content)?;
        Ok(())
    }

    /// List all goals in the vault
    pub fn list_goals(&self) -> VaultResult<Vec<String>> {
        let mut goals = Vec::new();
        let mut seen = HashSet::new();

        if !self.structure.goals.exists() {
            return Ok(goals);
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Check if goal.md exists
                    let goal_file = self.structure.goal_file(name);
                    if goal_file.exists() {
                        let id = self
                            .goal_id_from_frontmatter_path(&goal_file)
                            .unwrap_or_else(|| name.to_string());
                        if seen.insert(id.clone()) {
                            goals.push(id);
                        }
                    }
                }
                continue;
            }

            if file_type.is_file() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                    continue;
                }
                if let Some(stem) = path.file_stem().and_then(|name| name.to_str()) {
                    let id = self
                        .goal_id_from_frontmatter_path(&path)
                        .unwrap_or_else(|| stem.to_string());
                    if seen.insert(id.clone()) {
                        goals.push(id);
                    }
                }
            }
        }

        Ok(goals)
    }

    /// List all projects in the vault
    pub fn list_projects(&self) -> VaultResult<Vec<String>> {
        let mut projects = Vec::new();

        if !self.structure.projects.exists() {
            return Ok(projects);
        }

        for entry in std::fs::read_dir(&self.structure.projects)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Check if project.md exists
                    if self.structure.project_file(name).exists() {
                        projects.push(name.to_string());
                    }
                }
            }
        }

        Ok(projects)
    }

    /// Read a goal file
    pub fn read_goal(&self, goal_id: &str) -> VaultResult<(markdown_parser::Frontmatter, String)> {
        let location = self
            .find_goal_location(goal_id)?
            .ok_or_else(|| VaultError::ItemNotFound(goal_id.to_string()))?;

        let (path, is_flat, dir_name) = match location {
            GoalLocation::Directory(dir_path) => (
                dir_path.join("goal.md"),
                false,
                dir_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|s| s.to_string()),
            ),
            GoalLocation::Flat(flat_path) => (flat_path, true, None),
        };

        let content = std::fs::read_to_string(&path)?;
        let (mut frontmatter, body) = match markdown_parser::parse_frontmatter(&content) {
            Ok((frontmatter, body)) => (frontmatter, body),
            Err(markdown_parser::ParseError::MissingDelimiter) => {
                (markdown_parser::Frontmatter::new(), content)
            }
            Err(err) => return Err(err.into()),
        };
        if is_flat || !frontmatter.contains_key("id") {
            frontmatter.insert("id".into(), serde_yaml::Value::String(goal_id.to_string()));
        }
        if !frontmatter.contains_key("title") {
            let title = dir_name
                .unwrap_or_else(|| goal_id.to_string())
                .replace('-', " ")
                .replace('_', " ");
            frontmatter.insert("title".into(), serde_yaml::Value::String(title));
        }
        Ok((frontmatter, body))
    }

    /// Write a goal file
    pub fn write_goal(
        &self,
        goal_id: &str,
        frontmatter: &markdown_parser::Frontmatter,
        body: &str,
    ) -> VaultResult<()> {
        let content = markdown_parser::serialize_frontmatter(frontmatter, body);
        std::fs::create_dir_all(&self.structure.goals)?;
        let path = self.structure.goal_file_flat(goal_id);
        std::fs::write(&path, content)?;

        Ok(())
    }

    /// Delete a goal and all its tasks
    pub fn delete_goal(&self, goal_id: &str) -> VaultResult<()> {
        let location = self
            .find_goal_location(goal_id)?
            .ok_or_else(|| VaultError::ItemNotFound(goal_id.to_string()))?;

        match location {
            GoalLocation::Directory(dir_path) => std::fs::remove_dir_all(&dir_path)?,
            GoalLocation::Flat(flat_path) => std::fs::remove_file(&flat_path)?,
        }

        Ok(())
    }

    /// Read a project file
    pub fn read_project(
        &self,
        project_id: &str,
    ) -> VaultResult<(markdown_parser::Frontmatter, String)> {
        let path = self.structure.project_file(project_id);
        if !path.exists() {
            return Err(VaultError::ItemNotFound(project_id.to_string()));
        }

        let content = std::fs::read_to_string(&path)?;
        let (frontmatter, body) = markdown_parser::parse_frontmatter(&content)?;
        Ok((frontmatter, body))
    }

    /// Write a project file
    pub fn write_project(
        &self,
        project_id: &str,
        frontmatter: &markdown_parser::Frontmatter,
        body: &str,
    ) -> VaultResult<()> {
        let project_dir = self.structure.project_path(project_id);
        std::fs::create_dir_all(&project_dir)?;

        let tasks_dir = self.structure.project_tasks_path(project_id);
        std::fs::create_dir_all(&tasks_dir)?;

        let content = markdown_parser::serialize_frontmatter(frontmatter, body);
        let path = self.structure.project_file(project_id);
        std::fs::write(&path, content)?;

        Ok(())
    }

    /// Delete a project and all its contents
    pub fn delete_project(&self, project_id: &str) -> VaultResult<()> {
        let path = self.structure.project_path(project_id);
        if !path.exists() {
            return Err(VaultError::ItemNotFound(project_id.to_string()));
        }

        std::fs::remove_dir_all(&path)?;
        Ok(())
    }

    fn migrate_goals_to_flat(&self) -> VaultResult<()> {
        if !self.structure.goals.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let goal_dir = entry.path();
            let goal_file = goal_dir.join("goal.md");
            if !goal_file.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&goal_file)?;
            let (mut frontmatter, body) = match markdown_parser::parse_frontmatter(&content) {
                Ok((frontmatter, body)) => (frontmatter, body),
                Err(markdown_parser::ParseError::MissingDelimiter) => {
                    (markdown_parser::Frontmatter::new(), content)
                }
                Err(err) => return Err(err.into()),
            };

            let goal_id = frontmatter
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    goal_dir
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "untitled-goal".to_string());

            if !frontmatter.contains_key("id") {
                frontmatter.insert("id".into(), serde_yaml::Value::String(goal_id.clone()));
            }

            let notes = strip_milestones_section(&body);
            let milestones = collect_milestones(&goal_dir)?;
            let merged_body = build_milestone_body(&notes, &milestones);

            let flat_path = self.structure.goal_file_flat(&goal_id);
            if flat_path.exists() {
                continue;
            }

            let flat_content = markdown_parser::serialize_frontmatter(&frontmatter, &merged_body);
            std::fs::write(&flat_path, flat_content)?;
            std::fs::remove_dir_all(&goal_dir)?;
        }

        Ok(())
    }
}

struct LegacyMilestone {
    id: String,
    title: String,
    done: bool,
}

fn strip_milestones_section(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let header_index = lines.iter().position(|line| line.trim() == "## Milestones");

    if header_index.is_none() {
        return body.trim_end().to_string();
    }

    let header_index = header_index.unwrap();
    lines[..header_index].join("\n").trim_end().to_string()
}

fn build_milestone_body(notes: &str, milestones: &[LegacyMilestone]) -> String {
    let mut sections: Vec<String> = Vec::new();
    if !notes.trim().is_empty() {
        sections.push(notes.trim_end().to_string());
    }

    if !milestones.is_empty() {
        let mut milestone_block = String::new();
        milestone_block.push_str("## Milestones\n");
        for milestone in milestones {
            let checkbox = if milestone.done { "- [x]" } else { "- [ ]" };
            milestone_block.push_str(&format!(
                "{} {} <!-- id:{} -->\n",
                checkbox, milestone.title, milestone.id
            ));
        }
        sections.push(milestone_block.trim_end().to_string());
    }

    sections.join("\n\n")
}

fn collect_milestones(goal_dir: &Path) -> VaultResult<Vec<LegacyMilestone>> {
    let mut milestones = Vec::new();
    let dirs = [goal_dir.join("milestones"), goal_dir.join("tasks")];

    for dir in dirs {
        if !dir.exists() {
            continue;
        }

        let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("md"))
            .collect();
        entries.sort();

        for path in entries {
            let content = std::fs::read_to_string(&path)?;
            let (fm, _) = match markdown_parser::parse_frontmatter(&content) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };

            let is_task = fm
                .get("is_task")
                .or_else(|| fm.get("isTask"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if is_task {
                continue;
            }

            let id = fm
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());

            let title = fm
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| id.clone());

            let done = fm
                .get("column")
                .and_then(|v| v.as_str())
                .map(|s| s == "done")
                .unwrap_or(false)
                || fm.get("completed_at").is_some()
                || fm.get("completedAt").is_some();

            milestones.push(LegacyMilestone { id, title, done });
        }
    }

    Ok(milestones)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_create_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        assert_eq!(manager.config().name, "Test Vault");
        assert_eq!(manager.config().vault_type, VaultType::Private);
        assert!(manager.structure().config.exists());
        assert!(manager.structure().goalrate_dir.exists());
    }

    #[test]
    fn test_open_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        // Create first
        VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        // Open
        let manager = VaultManager::open(&vault_path).unwrap();
        assert_eq!(manager.config().name, "Test Vault");
        assert!(manager.config().last_opened.is_some());
    }

    #[test]
    fn test_open_nonexistent_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("nonexistent");

        let result = VaultManager::open(&vault_path);
        assert!(matches!(result, Err(VaultError::InvalidStructure(_))));
    }

    #[test]
    fn test_create_duplicate_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let result = VaultManager::create("Another Vault", &vault_path, VaultType::Private);
        assert!(matches!(result, Err(VaultError::AlreadyExists(_))));
    }

    #[test]
    fn test_goal_operations() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        // Create a goal
        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_test".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Test Goal".into()),
        );
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));

        manager
            .write_goal("goal_test", &frontmatter, "Goal description here.")
            .unwrap();

        let flat_goal_path = manager.structure().goal_file_flat("flat-goal");
        std::fs::write(&flat_goal_path, "Flat goal body.").unwrap();

        // List goals
        let mut goals = manager.list_goals().unwrap();
        goals.sort();
        assert_eq!(goals, vec!["flat-goal", "goal_test"]);

        // Read goal
        let (fm, body) = manager.read_goal("goal_test").unwrap();
        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Test Goal");
        assert_eq!(body, "Goal description here.");

        let (flat_fm, flat_body) = manager.read_goal("flat-goal").unwrap();
        assert_eq!(flat_fm.get("id").unwrap().as_str().unwrap(), "flat-goal");
        assert_eq!(flat_fm.get("title").unwrap().as_str().unwrap(), "flat goal");
        assert_eq!(flat_body, "Flat goal body.");

        // Delete goal
        manager.delete_goal("goal_test").unwrap();
        manager.delete_goal("flat-goal").unwrap();
        let goals = manager.list_goals().unwrap();
        assert!(goals.is_empty());
    }

    #[test]
    fn test_vault_structure_paths() {
        let structure = VaultStructure::new("/vault");

        assert_eq!(
            structure.goal_path("my-goal"),
            PathBuf::from("/vault/goals/my-goal")
        );
        assert_eq!(
            structure.goal_file("my-goal"),
            PathBuf::from("/vault/goals/my-goal/goal.md")
        );
        assert_eq!(
            structure.goal_tasks_path("my-goal"),
            PathBuf::from("/vault/goals/my-goal/milestones")
        );
        assert_eq!(
            structure.goal_file_flat("my-goal"),
            PathBuf::from("/vault/goals/my-goal.md")
        );
        assert_eq!(
            structure.project_path("my-project"),
            PathBuf::from("/vault/projects/my-project")
        );
        assert_eq!(
            structure.focus_file("2024-01-15"),
            PathBuf::from("/vault/focus/2024-01-15.md")
        );
    }
}
