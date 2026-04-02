CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    activity_id INTEGER,
    full_document_text TEXT NOT NULL DEFAULT '',
    document_name TEXT NOT NULL DEFAULT '',
    plain_text TEXT NOT NULL DEFAULT '',
    is_vectorized INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    in_knowledge_base INTEGER NOT NULL DEFAULT 0,
    content_type TEXT NOT NULL DEFAULT 'text',
    summary TEXT
);