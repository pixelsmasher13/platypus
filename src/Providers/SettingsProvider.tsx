import { parseEffortPreferences } from "../models/models";
import {
  createContext,
  useContext,
  type FC,
  type PropsWithChildren,
  useState,
  useEffect,
} from "react";
import { invoke } from "@tauri-apps/api";
import { enable, disable, isEnabled } from "tauri-plugin-autostart-api";
import { z } from "zod";

// Settings DB types
const settingDbItemZod = z.object({
  setting_key: z.string(),
  setting_value: z.string(),
});
const settingDbItemsZod = settingDbItemZod.array();
type SettingDbItem = z.infer<typeof settingDbItemZod>;

export const DEFAULT_SETTINGS: Settings = {
  is_dev_mode: false,
  interval: "10",
  auto_start: false,
  api_choice: "claude",
  api_key_claude: "",
  api_key_open_ai: "",
  api_key_gemini: "",
  local_model_url: "http://localhost:11434",
  vectorization_enabled: false,
  rag_top_k: 20,
  meeting_detection_enabled: true,
  model_claude: "",
  model_openai: "",
  model_gemini: "",
  use_local_transcription: true,
  keep_recordings: false,
  whisper_model: "large-v3",
  api_key_elevenlabs: "",
};

type Update = {
  (settings: Settings): Promise<void>;
};

type ApiChoice = "claude" | "openai" | "gemini" | "local";
export type Settings = {
  is_dev_mode: boolean;
  interval: string;
  auto_start: boolean;
  api_choice: ApiChoice;
  api_key_claude: string;
  api_key_open_ai: string;
  api_key_gemini: string;
  local_model_url: string;
  vectorization_enabled: boolean;
  rag_top_k: number;
  meeting_detection_enabled: boolean;
  model_claude: string;
  model_openai: string;
  model_gemini: string;
  use_local_transcription: boolean;
  keep_recordings: boolean;
  whisper_model: string;
  api_key_elevenlabs: string;
};

// While signed in, OpenAI chat and note features use the ChatGPT plan instead of the API key.
export type ChatGptStatus = { signed_in: boolean; email: string | null };

type SettingsContextType = {
  settings: Settings;
  update: Update;
  modelEfforts: Record<string, string>;
  setModelEffort: (model: string, effort: string) => Promise<void>;
  isSavingEffort: boolean;
  chatGpt: ChatGptStatus;
  setChatGpt: (status: ChatGptStatus) => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
);

export const SettingsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [modelEfforts, setModelEfforts] = useState<Record<string, string>>({});
  const [isSavingEffort, setIsSavingEffort] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [chatGpt, setChatGpt] = useState<ChatGptStatus>({ signed_in: false, email: null });

  const getSettingOrEmpty = (
    settings: SettingDbItem[],
    settingKey: string
  ): string => {
    const filtered = settings
      .filter((setting) => setting.setting_key == settingKey)
      .map((setting) => setting.setting_value);
    if (filtered != null && filtered.length > 0) {
      return filtered[0];
    }
    return "";
  };

  const buildSettings = (response: SettingDbItem[]): Settings => {
    return {
      interval: getSettingOrEmpty(response, "interval") || "20",
      is_dev_mode: getSettingOrEmpty(response, "is_dev_mode") == "true",
      auto_start: getSettingOrEmpty(response, "auto_start") == "true",
      api_choice:
        (getSettingOrEmpty(response, "api_choice") as ApiChoice) || "claude",
      api_key_claude: getSettingOrEmpty(response, "api_key_claude") || "",
      api_key_open_ai: getSettingOrEmpty(response, "api_key_open_ai") || "",
      api_key_gemini: getSettingOrEmpty(response, "api_key_gemini") || "",
      local_model_url: getSettingOrEmpty(response, "local_model_url") || "http://localhost:11434",
      vectorization_enabled: getSettingOrEmpty(response, "vectorization_enabled") == "true",
      rag_top_k: parseInt(getSettingOrEmpty(response, "rag_top_k")) || 20,
      meeting_detection_enabled: getSettingOrEmpty(response, "meeting_detection_enabled") == "true",
      model_claude: getSettingOrEmpty(response, "model_claude") || "",
      model_openai: getSettingOrEmpty(response, "model_openai") || "",
      model_gemini: getSettingOrEmpty(response, "model_gemini") || "",
      use_local_transcription: getSettingOrEmpty(response, "use_local_transcription") !== "false",
      keep_recordings: getSettingOrEmpty(response, "keep_recordings") === "true",
      whisper_model: getSettingOrEmpty(response, "whisper_model") || "large-v3",
      api_key_elevenlabs: getSettingOrEmpty(response, "api_key_elevenlabs") || "",
    };
  };

  useEffect(() => {
    invoke("get_latest_settings").then(async (response) => {
      const parsed = settingDbItemsZod.safeParse(response);
      if (parsed.success) {
        setModelEfforts(parseEffortPreferences(getSettingOrEmpty(parsed.data, "model_efforts")));
        const builtSettings = buildSettings(parsed.data);
        const autoStartEnabled = await isEnabled();
        setSettings({
          ...builtSettings,
          auto_start: autoStartEnabled,
        });
      } else {
        console.error("invoke get_latest_settings Error:", parsed.error);
      }
    });
    invoke<ChatGptStatus>("chatgpt_status").then(setChatGpt).catch(console.error);
  }, []);

  const update: Update = async (newSettings) => {
    if (newSettings.auto_start !== settings.auto_start) {
      if (newSettings.auto_start) {
        await enable();
      } else {
        await disable();
      }
    }
    await updateSettingsOnRust(newSettings);
    setSettings(newSettings);
    return Promise.resolve();
  };

  const setModelEffort = async (model: string, effort: string) => {
    setIsSavingEffort(true);
    try {
      const saved = await invoke<Record<string, string>>("set_model_effort", { model, effort });
      setModelEfforts(saved);
    } finally { setIsSavingEffort(false); }
  };

  return (
    <SettingsContext.Provider value={{ settings, update, modelEfforts, setModelEffort, isSavingEffort, chatGpt, setChatGpt }}>
      {children}
    </SettingsContext.Provider>
  );
};

const updateSettingsOnRust = (settings: Settings) => {
  return invoke("update_settings", { settings });
};

export const useGlobalSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw Error("SettingsContext must be used within a SettingsProvider");
  }
  return context;
};
