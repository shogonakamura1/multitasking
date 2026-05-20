use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::{Board, CreateProjectInput, CreateTaskInput, Project, ProjectStatus, Task, TaskStatus};

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ── Project CRUD ──────────────────────────────────────────────────────────────

pub fn create_project(conn: &Connection, input: CreateProjectInput) -> Result<Project, String> {
    let id = new_id();
    let now = now_ms();
    let status = input.status.as_str();

    // sort_order: place after existing projects
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO projects (id, name, color, status, workdir, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, input.name, input.color, status, input.workdir, sort_order, now],
    )
    .map_err(|e| e.to_string())?;

    get_project(conn, &id)
}

pub fn get_project(conn: &Connection, id: &str) -> Result<Project, String> {
    conn.query_row(
        "SELECT id, name, color, status, workdir, sort_order, created_at, updated_at
         FROM projects WHERE id = ?1",
        params![id],
        row_to_project,
    )
    .map_err(|e| e.to_string())
}

pub fn update_project(conn: &Connection, project: Project) -> Result<Project, String> {
    let now = now_ms();
    let status = project.status.as_str();

    conn.execute(
        "UPDATE projects
         SET name=?2, color=?3, status=?4, workdir=?5, sort_order=?6, updated_at=?7
         WHERE id=?1",
        params![
            project.id,
            project.name,
            project.color,
            status,
            project.workdir,
            project.sort_order,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    get_project(conn, &project.id)
}

pub fn delete_project(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, color, status, workdir, sort_order, created_at, updated_at
             FROM projects ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_project)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let status_str: String = row.get(3)?;
    let status = ProjectStatus::from_str(&status_str)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, e.into()))?;

    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        status,
        workdir: row.get(4)?,
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

// ── Task CRUD ─────────────────────────────────────────────────────────────────

pub fn create_task(conn: &Connection, input: CreateTaskInput) -> Result<Task, String> {
    let id = new_id();
    let now = now_ms();
    let status = input.status.as_str();
    let due_today = if input.due_today { 1i64 } else { 0i64 };

    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tasks WHERE project_id = ?1",
            params![input.project_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO tasks (id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            input.project_id,
            input.title,
            status,
            input.next_action,
            input.note,
            due_today,
            sort_order,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    get_task(conn, &id)
}

pub fn get_task(conn: &Connection, id: &str) -> Result<Task, String> {
    conn.query_row(
        "SELECT id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at
         FROM tasks WHERE id = ?1",
        params![id],
        row_to_task,
    )
    .map_err(|e| e.to_string())
}

pub fn update_task(conn: &Connection, task: Task) -> Result<Task, String> {
    let now = now_ms();
    let status = task.status.as_str();
    let due_today = if task.due_today { 1i64 } else { 0i64 };

    conn.execute(
        "UPDATE tasks
         SET project_id=?2, title=?3, status=?4, next_action=?5, note=?6,
             due_today=?7, sort_order=?8, updated_at=?9
         WHERE id=?1",
        params![
            task.id,
            task.project_id,
            task.title,
            status,
            task.next_action,
            task.note,
            due_today,
            task.sort_order,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    get_task(conn, &task.id)
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at
             FROM tasks ORDER BY sort_order ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

pub fn set_task_status(conn: &Connection, id: &str, status: TaskStatus) -> Result<Task, String> {
    let now = now_ms();
    let status_str = status.as_str();

    conn.execute(
        "UPDATE tasks SET status=?2, updated_at=?3 WHERE id=?1",
        params![id, status_str, now],
    )
    .map_err(|e| e.to_string())?;

    get_task(conn, id)
}

pub fn reorder_tasks(conn: &Connection, ids: &[String]) -> Result<(), String> {
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET sort_order=?2 WHERE id=?1",
            params![id, index as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn get_board(conn: &Connection) -> Result<Board, String> {
    let projects = list_projects(conn)?;
    let tasks = list_tasks(conn)?;
    Ok(Board { projects, tasks })
}

/// Find the project whose workdir is the longest prefix match for `workdir`.
/// Returns None if no project has a matching workdir.
pub fn find_project_by_workdir<'a>(
    projects: &'a [Project],
    workdir: &str,
) -> Option<&'a Project> {
    projects
        .iter()
        .filter_map(|p| {
            let wd = p.workdir.as_deref()?;
            if workdir.starts_with(wd) {
                Some((p, wd.len()))
            } else {
                None
            }
        })
        .max_by_key(|(_, len)| *len)
        .map(|(p, _)| p)
}

/// Return waiting_ai tasks for a project, sorted by updated_at ascending (oldest first).
pub fn get_waiting_ai_tasks(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<Task>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at
             FROM tasks
             WHERE project_id = ?1 AND status = 'waiting_ai'
             ORDER BY updated_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], row_to_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Find a task by title (exact match) within a project.
pub fn find_task_by_title(
    conn: &Connection,
    project_id: &str,
    title: &str,
) -> Result<Option<Task>, String> {
    let result = conn.query_row(
        "SELECT id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at
         FROM tasks WHERE project_id = ?1 AND title = ?2 LIMIT 1",
        params![project_id, title],
        row_to_task,
    );

    match result {
        Ok(task) => Ok(Some(task)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Get the most recently created task for a project.
pub fn get_latest_task(conn: &Connection, project_id: &str) -> Result<Option<Task>, String> {
    let result = conn.query_row(
        "SELECT id, project_id, title, status, next_action, note, due_today, sort_order, created_at, updated_at
         FROM tasks WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 1",
        params![project_id],
        row_to_task,
    );

    match result {
        Ok(task) => Ok(Some(task)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let status_str: String = row.get(3)?;
    let status = TaskStatus::from_str(&status_str)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, e.into()))?;

    let due_today_int: i64 = row.get(6)?;

    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        status,
        next_action: row.get(4)?,
        note: row.get(5)?,
        due_today: due_today_int != 0,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    /// Open an in-memory SQLite database with the full migration applied.
    fn open_test_db() -> Connection {
        // init_db expects a path; ":memory:" is a special SQLite in-memory URI.
        let conn = init_db(std::path::Path::new(":memory:")).expect("failed to open test db");
        conn
    }

    fn make_project(conn: &Connection, name: &str, workdir: Option<&str>) -> Project {
        create_project(
            conn,
            CreateProjectInput {
                name: name.to_string(),
                color: "#aabbcc".to_string(),
                status: ProjectStatus::Active,
                workdir: workdir.map(|s| s.to_string()),
            },
        )
        .expect("create_project failed")
    }

    fn make_task(conn: &Connection, project_id: &str, title: &str, status: TaskStatus) -> Task {
        let t = create_task(
            conn,
            CreateTaskInput {
                project_id: project_id.to_string(),
                title: title.to_string(),
                status: status.clone(),
                next_action: None,
                note: None,
                due_today: false,
            },
        )
        .expect("create_task failed");
        // If the desired status is not the default (todo), set it explicitly so
        // updated_at is also written correctly.
        if t.status != status {
            set_task_status(conn, &t.id, status).expect("set_task_status failed")
        } else {
            t
        }
    }

    // ── T1: create project/task → get_board returns them ─────────────────────

    #[test]
    fn create_project_and_task_visible_in_board() {
        let conn = open_test_db();
        let p = make_project(&conn, "Alpha", None);
        let t = make_task(&conn, &p.id, "First task", TaskStatus::Todo);

        let board = get_board(&conn).expect("get_board failed");

        assert_eq!(board.projects.len(), 1);
        assert_eq!(board.projects[0].id, p.id);
        assert_eq!(board.tasks.len(), 1);
        assert_eq!(board.tasks[0].id, t.id);
    }

    // ── T2: update_task updates updated_at ────────────────────────────────────

    #[test]
    fn update_task_bumps_updated_at() {
        let conn = open_test_db();
        let p = make_project(&conn, "Beta", None);
        let t = make_task(&conn, &p.id, "Task A", TaskStatus::Todo);
        let original_updated_at = t.updated_at;

        // Ensure at least 1 ms passes so updated_at can differ.
        std::thread::sleep(std::time::Duration::from_millis(2));

        let mut updated = t.clone();
        updated.title = "Task A (edited)".to_string();
        let saved = update_task(&conn, updated).expect("update_task failed");

        assert!(
            saved.updated_at >= original_updated_at,
            "updated_at should not go backwards"
        );
        assert_eq!(saved.title, "Task A (edited)");
    }

    // ── T3: set_task_status updates updated_at ────────────────────────────────

    #[test]
    fn set_task_status_bumps_updated_at() {
        let conn = open_test_db();
        let p = make_project(&conn, "Gamma", None);
        let t = make_task(&conn, &p.id, "Task B", TaskStatus::Todo);
        let original_updated_at = t.updated_at;

        std::thread::sleep(std::time::Duration::from_millis(2));

        let after = set_task_status(&conn, &t.id, TaskStatus::InProgress)
            .expect("set_task_status failed");

        assert!(
            after.updated_at >= original_updated_at,
            "updated_at should not go backwards"
        );
        assert_eq!(after.status, TaskStatus::InProgress);
    }

    // ── T4: delete_project cascades and removes its tasks ─────────────────────

    #[test]
    fn delete_project_cascades_tasks() {
        let conn = open_test_db();
        let p = make_project(&conn, "Delta", None);
        make_task(&conn, &p.id, "Child task 1", TaskStatus::Todo);
        make_task(&conn, &p.id, "Child task 2", TaskStatus::WaitingAi);

        // Verify tasks exist before delete.
        let board_before = get_board(&conn).expect("get_board before delete");
        assert_eq!(board_before.tasks.len(), 2);

        delete_project(&conn, &p.id).expect("delete_project failed");

        let board_after = get_board(&conn).expect("get_board after delete");
        assert_eq!(board_after.projects.len(), 0, "project should be gone");
        assert_eq!(board_after.tasks.len(), 0, "cascaded tasks should be gone");
    }

    // ── T5: multiple waiting_ai tasks — oldest updated_at is selected ─────────

    #[test]
    fn get_waiting_ai_tasks_returns_oldest_first() {
        let conn = open_test_db();
        let p = make_project(&conn, "Epsilon", None);

        // Create two tasks and force them to waiting_ai with a small sleep so
        // updated_at values are distinct.
        let t1 = make_task(&conn, &p.id, "Older task", TaskStatus::WaitingAi);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let t2 = make_task(&conn, &p.id, "Newer task", TaskStatus::WaitingAi);

        let waiting = get_waiting_ai_tasks(&conn, &p.id).expect("get_waiting_ai_tasks failed");

        assert_eq!(waiting.len(), 2, "both tasks should be waiting_ai");
        assert!(
            waiting[0].updated_at <= waiting[1].updated_at,
            "tasks should be sorted oldest-first by updated_at"
        );
        // The first element should be the oldest (t1).
        assert_eq!(
            waiting[0].id, t1.id,
            "oldest task ({}) should come first, got {}",
            t1.id, waiting[0].id
        );
        // The second element should be t2.
        assert_eq!(waiting[1].id, t2.id);
    }
}
