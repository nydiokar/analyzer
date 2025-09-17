-- Add deletedAt column for soft delete of messages
ALTER TABLE Message ADD COLUMN deletedAt DATETIME;

-- Optional index to keep list queries efficient
CREATE INDEX IF NOT EXISTS idx_message_deleted_created ON Message (deletedAt, createdAt, id);


