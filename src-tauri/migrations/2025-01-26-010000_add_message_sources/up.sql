-- Add sources column to messages table to store RAG chunk sources as JSON
ALTER TABLE messages ADD COLUMN sources TEXT;
