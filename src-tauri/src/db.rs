use rusqlite::{Connection, Result as RusqliteResult};
use std::path::Path;

/// Initialize the SQLite database and run migrations.
/// Returns a connection with WAL mode enabled and foreign keys on.
pub fn init_db(db_path: &Path) -> RusqliteResult<Connection> {
    let conn = Connection::open(db_path)?;

    // Reliability settings
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    migrate(&conn)?;

    Ok(conn)
}

fn migrate(conn: &Connection) -> RusqliteResult<()> {
    let version: i64 = conn.query_row(
        "PRAGMA user_version",
        [],
        |row| row.get(0),
    )?;

    if version < 1 {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
              id          TEXT PRIMARY KEY,
              name        TEXT NOT NULL,
              color       TEXT NOT NULL,
              status      TEXT NOT NULL,
              workdir     TEXT,
              sort_order  INTEGER NOT NULL DEFAULT 0,
              created_at  INTEGER NOT NULL,
              updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
              id           TEXT PRIMARY KEY,
              project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title        TEXT NOT NULL,
              status       TEXT NOT NULL,
              next_action  TEXT,
              note         TEXT,
              due_today    INTEGER NOT NULL DEFAULT 0,
              sort_order   INTEGER NOT NULL DEFAULT 0,
              created_at   INTEGER NOT NULL,
              updated_at   INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

            PRAGMA user_version = 1;
            ",
        )?;
    }

    Ok(())
}
