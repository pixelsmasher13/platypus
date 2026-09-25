import { EffortSelector } from "./EffortSelector";
import { FC } from "react";
import { MODEL_OPTIONS, getConfiguredModel } from "../../../models/models";
import {
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Button,
  Flex,
  Text,
} from "@chakra-ui/react";
import { ChevronDownIcon } from "@chakra-ui/icons";
import { useGlobalSettings } from "../../../Providers/SettingsProvider";

type ModelSelectorProps = {
  onModelChange: (modelId: string, provider: "claude" | "openai" | "gemini" | "local") => void;
  currentModel?: string;
};

export const ModelSelector: FC<ModelSelectorProps> = ({ 
  onModelChange,
  currentModel: externalCurrentModel 
}) => {
  const { settings } = useGlobalSettings();
  const currentModel = externalCurrentModel || getConfiguredModel(settings);
  const modelOptions = MODEL_OPTIONS;
  const handleModelChange = (modelId: string) => {
    const selectedModel = modelOptions.find(model => model.id === modelId);
    if (selectedModel) onModelChange(modelId, selectedModel.provider);
  };

  // Get the current model's display info
  const currentModelInfo = modelOptions.find(m => m.id === currentModel);

  return (
    <Flex alignItems="center" gap={2} flexWrap="wrap">
      <Menu>
        <MenuButton 
          as={Button} 
          rightIcon={<ChevronDownIcon />}
          size="sm"
          variant="outline"
         fontWeight="normal"  // Add this line to ensure normal font weight
        >
          {currentModelInfo ? currentModelInfo.name : currentModel}
        </MenuButton>
        <MenuList>
          {modelOptions.map((model) => (
            <MenuItem 
              key={model.id}
              onClick={() => handleModelChange(model.id)}
        //      fontWeight={currentModel === model.id ? "bold" : "normal"}
            >
              <Flex direction="column">
                <Text fontSize="sm">{model.name}</Text>
                <Text fontSize="xs" color="gray.500">{model.description}</Text>
              </Flex>
            </MenuItem>
          ))}
        </MenuList>
      </Menu>
      <EffortSelector model={currentModel} />
    </Flex>
  );
};