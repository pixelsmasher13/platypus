// OnboardingScreen.tsx
import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from "framer-motion";
import { Input, Select } from "@chakra-ui/react";
import { useGlobalSettings } from "@/Providers/SettingsProvider";

const KeyContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
`;

const OnboardingContainer = styled(motion.div)`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  text-align: center;
  background: linear-gradient(135deg, #0f766e, #0d9488, #5eead4);
  color: white;
`;

const ContentWrapper = styled(motion.div)`
  max-width: 800px;
  padding: 2rem;
`;

const Title = styled(motion.h1)`
  font-size: 2.5rem;
  margin-bottom: 1rem;
`;

const Content = styled(motion.p)`
  font-size: 1.2rem;
  margin-bottom: 2rem;
`;

const Button = styled(motion.button)`
  padding: 12px 24px;
  font-size: 1rem;
  background-color: white;
  color: #0d9488;
  border: none;
  border-radius: 30px;
  cursor: pointer;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }
`;

const ProgressDots = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 2rem;
`;

const Dot = styled(motion.div)`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: white;
  margin: 0 5px;
`;

const initialSteps = [
  {
    title: "Welcome to Platypus",
    content: "Notes, transcription, and knowledge management — all in one fast, private app.",
  },
  {
    title: "Here's how it works",
    content: "Create projects, take notes, record and transcribe meetings, import documents, and chat with AI across your knowledge base.",
    prompts: [
      "Summarize my meeting notes",
      "Draft a project update",
      "Brainstorm launch ideas",
    ],
  },
  {
    title: "Add your API key to get started",
    content: "Pick your preferred AI provider. You can always change this later in Settings.",
  },
];

interface OnboardingScreenProps {
  onComplete: () => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({
  onComplete,
}) => {
  const { settings, update } = useGlobalSettings();
  const steps = initialSteps;
  const [step, setStep] = useState(0);

  type ApiChoice = "claude" | "openai" | "gemini" | "local";
  const handleApiChoiceChange = (value: ApiChoice) => {
    update({ ...settings, api_choice: value });
  };

  const onChangeApiKey = (value: string) => {
    if (settings.api_choice === "claude") {
      update({ ...settings, api_key_claude: value });
    } else if (settings.api_choice === "openai") {
      update({ ...settings, api_key_open_ai: value });
    } else if (settings.api_choice === "gemini") {
      update({ ...settings, api_key_gemini: value });
    }
  };

  const getCurrentApiKey = () => {
    switch (settings.api_choice) {
      case "claude": return settings.api_key_claude;
      case "openai": return settings.api_key_open_ai;
      case "gemini": return settings.api_key_gemini;
      default: return "";
    }
  };

  const nextStep = async () => {
    if (
      step &&
      steps.length - 1 &&
      !settings.api_key_claude &&
      !settings.api_key_open_ai
    ) {
      console.error("API key not set");
    }

//  if (isMacOS && step === steps.length - 2) {
 //     try {
 //       await invoke("prompt_for_accessibility_permissions");
 //     } catch (error) {
 //       console.error("Error requesting permissions:", error);
 //       // You might want to handle this error, perhaps by showing a message to the user
 //     }
 //   }

    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <OnboardingContainer
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <ContentWrapper>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.5 }}
          >
            <Title>{steps[step].title}</Title>
            <Content>{steps[step].content}</Content>
            {step < steps.length - 1 ? (
              steps[step].prompts && (
                <PromptsContainer>
                  {steps[step]?.prompts?.map((prompt, index) => (
                    <Prompt key={index}>{prompt}</Prompt>
                  ))}
                </PromptsContainer>
              )
            ) : (
              <KeyContainer>
                <Select
                  size="md"
                  value={settings.api_choice}
                  onChange={(event) =>
                    handleApiChoiceChange(event.target.value as ApiChoice)
                  }
                >
                  <option value="claude">Claude</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="local">Local (Ollama)</option>
                </Select>

                {settings.api_choice !== "local" && (
                  <Input
                    placeholder="API key"
                    style={{ color: "white" }}
                    value={getCurrentApiKey()}
                    onChange={(event) => onChangeApiKey(event.target.value)}
                    _placeholder={{ opacity: 0.8, color: "inherit" }}
                  />
                )}

                <LocalTranscriptionToggle>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={settings.use_local_transcription}
                      onChange={(e) => update({ ...settings, use_local_transcription: e.target.checked })}
                      style={{ width: "18px", height: "18px", accentColor: "#0d9488" }}
                    />
                    <span style={{ fontSize: "0.95rem" }}>
                      Use local voice transcription (offline, no API key needed)
                    </span>
                  </label>
                  <span style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: "4px", display: "block" }}>
                    Downloads a ~1.5GB model on first use. Shows live transcript during recording.
                  </span>
                </LocalTranscriptionToggle>
              </KeyContainer>
            )}
          </motion.div>
        </AnimatePresence>
        <Button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={nextStep}
        >
          {step < steps.length - 1 ? "Continue" : "Let's Go!"}
        </Button>
      </ContentWrapper>
      <ProgressDots>
        {steps.map((_, index) => (
          <Dot
            key={index}
            animate={{
              scale: index === step ? 1.2 : 1,
              opacity: index === step ? 1 : 0.5,
            }}
          />
        ))}
      </ProgressDots>
    </OnboardingContainer>
  );
};

// Add these new styled components
const PromptsContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 1rem;
  margin-bottom: 2rem;
`;

const Prompt = styled.div`
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 8px 12px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.3s ease;
  flex: 0 1 auto;
  white-space: nowrap;
  text-align: center;

  &:hover {
    background-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
  }
`;

const LocalTranscriptionToggle = styled.div`
  margin-top: 8px;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  text-align: left;
`;
