import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  FormControl,
  Button,
  Input,
  Text,
  Flex,
} from "@chakra-ui/react";
import { Title } from "@platypus-app/design";
import { useForm } from "react-hook-form";
import { useProject } from "../../state";
import { type Project } from "../../data/project";

type FormValues = {
  name: string;
};

interface ProjectModalProps {
  isOpen: boolean;
  projectId: number | null;
  onClose: () => void;
  onSave: (data: Omit<Project, "id">) => Promise<void>;
  onUpdate: (data: Project) => Promise<void>;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  projectId,
  onClose,
  onUpdate,
  onSave,
}) => {
  // Form handling
  const {
    register,
    setValue,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const { state } = useProject();

  // Get current project when editing
  const currentProject = state.projects.find((project) => project.id === projectId);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  // Populate form when editing existing project
  useEffect(() => {
    if (currentProject) {
      setValue("name", currentProject.name);
    }
  }, [currentProject, setValue]);

  // Form submission handlers
  const handleCreate = async (data: FormValues) => {
    setIsSubmittingForm(true);
    try {
      await onSave({
        name: data.name,
        activities: [], // Empty array since we're not selecting any activities
        activity_ids: [], // Required by Project type but not used by Tauri command
        activity_names: [], // Required by Project type but not used by Tauri command
      });
      onClose();
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleUpdate = async (data: FormValues) => {
    if (!currentProject) return;
  
    setIsSubmittingForm(true);
    try {
      await onUpdate({
        id: currentProject.id,
        name: data.name,
        activities: currentProject.activities, // Preserve existing activities
        activity_ids: currentProject.activity_ids, // Required by Project type
        activity_names: currentProject.activity_names, // Required by Project type
      });
      onClose();
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // Error handling for required name field
  const nameError = errors.name?.message;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      isCentered
      motionPreset="slideInBottom"
    >
      <ModalOverlay />
      <ModalContent
        width="100%"
        maxWidth="500px"
        css={`
          @media (max-width: 1024px) {
            max-width: 90%;
          }
        `}
      >
        <ModalHeader>
          <Title type="m">{currentProject ? "Edit Project" : "Create New Project"}</Title>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Flex gap="8px" flexDirection="column">
            <FormControl isInvalid={!!nameError}>
              <Input
                id="name"
                placeholder="Project Name"
                {...register("name", { 
                  required: "Name is required",
                  minLength: { value: 2, message: "Name must be at least 2 characters" }
                })}
                autoFocus
              />
              {nameError && (
                <Text color="red.500" fontSize="sm" mt={1}>
                  {nameError}
                </Text>
              )}
            </FormControl>

            <Button
              colorScheme="teal"
              type="submit"
              width="full"
              mt={4}
              isLoading={isSubmittingForm || isSubmitting}
              onClick={handleSubmit(currentProject ? handleUpdate : handleCreate)}
            >
              {currentProject ? "Update" : "Create"}
            </Button>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};