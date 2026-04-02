export type StoredMessage = {
  id: number;
  chat_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: ChunkSource[];
};

export type Chat = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ChunkSource = {
  chunk_id: number;
  document_id: number;
  document_name: string;
  chunk_index: number;
  chunk_preview: string;
};
