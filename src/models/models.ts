export type ModelProvider = "claude" | "openai" | "gemini" | "local";

export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  claude: "claude-sonnet-5",
  openai: "gpt-6-astra",
  gemini: "gemini-3-pro-preview",
  local: "llama3.3:70b",
};

export const MODEL_OPTIONS: { id: string; name: string; provider: ModelProvider; description: string }[] = [
  { id: DEFAULT_MODELS.claude, name: "Claude Sonnet 5", provider: "claude", description: "Balanced speed and intelligence" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "claude", description: "Fast, lightweight tasks" },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "claude", description: "Previous-generation Opus" },
  { id: DEFAULT_MODELS.openai, name: "GPT-6 Astra", provider: "openai", description: "Most capable GPT model" },
  { id: "gpt-6-sol", name: "GPT-6 Sol", provider: "openai", description: "Strong reasoning at lower cost" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", provider: "openai", description: "Fast, efficient everyday tasks" },
  { id: DEFAULT_MODELS.gemini, name: "Gemini 3 Pro", provider: "gemini", description: "Google multimodal model" },
  { id: DEFAULT_MODELS.local, name: "Llama 3.3 70B", provider: "local", description: "Local via Ollama" },
];

type ModelSettings = {
  api_choice: ModelProvider;
  model_claude: string;
  model_openai: string;
  model_gemini: string;
};

export function getConfiguredModel(settings: ModelSettings): string {
  const provider = settings.api_choice;
  const custom = provider === "local" ? "" : settings[`model_${provider}`];
  return custom?.trim() || DEFAULT_MODELS[provider];
}

export type Effort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LABELS: Record<Effort, string> = {
  none: "Off", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max",
};
const isFamily = (model: string, family: string) => model === family || model.startsWith(`${family}-`);
export function effortOptions(model: string): Effort[] {
  if (isFamily(model, "gpt-6-astra")) return ["low", "medium", "high", "xhigh", "max"];
  if (["gpt-6-sol", "gpt-6-luna", "claude-sonnet-5"].some(family => isFamily(model, family))) {
    return ["none", "low", "medium", "high", "xhigh", "max"];
  }
  if (["claude-opus-4-6", "claude-sonnet-4-6"].some(family => isFamily(model, family))) {
    return ["none", "low", "medium", "high", "max"];
  }
  return [];
}
export function selectedEffort(model: string, preferences: Record<string, string>): Effort | undefined {
  const options = effortOptions(model);
  const saved = preferences[model] as Effort;
  return options.includes(saved) ? saved : options[0];
}
export function parseEffortPreferences(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, effort]) => typeof effort === "string")) as Record<string, string>;
  } catch { return {}; }
}
