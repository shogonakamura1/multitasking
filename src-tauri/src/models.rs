use serde::{Deserialize, Serialize};

// ── Status enums ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Active,
    Paused,
    Done,
}

impl Default for ProjectStatus {
    fn default() -> Self {
        ProjectStatus::Active
    }
}

impl ProjectStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProjectStatus::Active => "active",
            ProjectStatus::Paused => "paused",
            ProjectStatus::Done => "done",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "active" => Ok(ProjectStatus::Active),
            "paused" => Ok(ProjectStatus::Paused),
            "done" => Ok(ProjectStatus::Done),
            other => Err(format!("unknown project status: {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    WaitingAi,
    Blocked,
    Done,
}

impl Default for TaskStatus {
    fn default() -> Self {
        TaskStatus::Todo
    }
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Todo => "todo",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::WaitingAi => "waiting_ai",
            TaskStatus::Blocked => "blocked",
            TaskStatus::Done => "done",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "todo" => Ok(TaskStatus::Todo),
            "in_progress" => Ok(TaskStatus::InProgress),
            "waiting_ai" => Ok(TaskStatus::WaitingAi),
            "blocked" => Ok(TaskStatus::Blocked),
            "done" => Ok(TaskStatus::Done),
            other => Err(format!("unknown task status: {other}")),
        }
    }
}

// ── Core models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub status: ProjectStatus,
    pub workdir: Option<String>,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub next_action: Option<String>,
    pub note: Option<String>,
    pub due_today: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
}

// ── Input models ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub status: ProjectStatus,
    pub workdir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub status: TaskStatus,
    pub next_action: Option<String>,
    pub note: Option<String>,
    #[serde(default)]
    pub due_today: bool,
}

// ── Hook models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInfo {
    pub port: u16,
    pub token: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRequest {
    pub event: String,
    pub workdir: String,
    pub task: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCompletedPayload {
    pub project_id: String,
    pub task_id: Option<String>,
    pub project_name: String,
    pub task_title: Option<String>,
}
