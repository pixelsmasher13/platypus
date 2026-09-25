import { Select, Tooltip, useToast } from "@chakra-ui/react";
import { useGlobalSettings } from "../../../Providers/SettingsProvider";
import { effortOptions, selectedEffort, EFFORT_LABELS } from "../../../models/models";

export function EffortSelector({ model, disabled = false }: { model: string; disabled?: boolean }) {
  const { modelEfforts, setModelEffort, isSavingEffort } = useGlobalSettings();
  const toast = useToast();
  const options = effortOptions(model);
  if (!options.length) return null;
  return (
    <Tooltip label="Higher effort gives the model more time to think. Saved for this model across chat and generation.">
      <Select aria-label="Reasoning effort" size="sm" width="auto" minW="145px" borderRadius="md"
        value={selectedEffort(model, modelEfforts)} isDisabled={disabled || isSavingEffort}
        onChange={async event => {
          try { await setModelEffort(model, event.target.value); }
          catch { toast({ title: "Couldn't save effort", description: "Please try again.", status: "error", duration: 4000, isClosable: true }); }
        }}>
        {options.map(effort => <option key={effort} value={effort}>Effort: {EFFORT_LABELS[effort]}</option>)}
      </Select>
    </Tooltip>
  );
}
