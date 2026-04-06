import React from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Box,
} from "@chakra-ui/react";
import { Title } from "@platypus-app/design";
import { GeneralSettings } from "../../../features";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCategory?: string;
  setActiveCategory?: (category: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      isCentered
      motionPreset="slideInBottom"
      scrollBehavior="inside"
    >
      <ModalOverlay />
      <ModalContent
        width="100%"
        maxWidth="600px"
        height="auto"
        maxHeight="80vh"
        css={`
          @media (max-width: 1024px) {
            max-width: 90%;
          }
        `}
      >
        <ModalHeader>
          <Title type="m">Settings</Title>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody
          pb={6}
          sx={{
            "&::-webkit-scrollbar": { width: "8px" },
            "&::-webkit-scrollbar-track": { bg: "gray.50", borderRadius: "4px" },
            "&::-webkit-scrollbar-thumb": { bg: "gray.300", borderRadius: "4px" },
            "&::-webkit-scrollbar-thumb:hover": { bg: "gray.400" },
          }}
        >
          <Box>
            <GeneralSettings />
          </Box>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
