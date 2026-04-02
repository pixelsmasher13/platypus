import { FC, useState, useEffect } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Button,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Text,
  Checkbox,
  Spinner,
  Flex,
  Badge,
} from "@chakra-ui/react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/tauri";

type SelectActivityModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selectedActivities: Array<{ id: number; text: string }>) => void;
};

// Document from projects: [id, document_name, project_name, created_at]
type ProjectDocument = [number, string, string, string];

const ScrollableContainer = styled.div`
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--default-border-color);
  border-radius: var(--border-radius-m);
`;

const TruncatedText = styled(Text)`
  max-width: 250px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const EmptyState = styled.div`
  padding: 40px;
  text-align: center;
  color: var(--text-secondary, #888);
`;

export const SelectActivityModal: FC<SelectActivityModalProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const fetchDocuments = async () => {
    setIsLoading(true);
    try {
      const result = await invoke<ProjectDocument[]>("get_all_project_documents");
      setDocuments(result);
    } catch (error) {
      console.error("Error fetching documents:", error);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      fetchDocuments();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSelectedDocuments(new Set());
    } else {
      setDocuments([]);
    }
  }, [isOpen]);

  const handleToggleSelect = (documentId: number) => {
    setSelectedDocuments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(documentId)) {
        newSet.delete(documentId);
      } else {
        newSet.add(documentId);
      }
      return newSet;
    });
  };

  const handleAddSelected = async () => {
    const selectedDocumentData = await Promise.all(
      Array.from(selectedDocuments).map(async (id) => {
        // Get plain text for the document
        const result = await invoke<[string, string] | null>("get_app_project_activity_plain_text", {
          activityId: id,
        });
        const text = result ? result[1] : "";
        return { id, text };
      })
    );
    onSelect(selectedDocumentData);
    onClose();
  };

  const handleClose = () => {
    onClose();
    setSelectedDocuments(new Set());
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="4xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Attach notes to your chat</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <ScrollableContainer>
            {isLoading ? (
              <Flex justify="center" p={8}>
                <Spinner
                  thickness="4px"
                  speed="0.65s"
                  emptyColor="gray.200"
                  color="blue.500"
                  size="md"
                />
              </Flex>
            ) : documents.length === 0 ? (
              <EmptyState>
                <Text>No documents found. Add documents to your projects first.</Text>
              </EmptyState>
            ) : (
              <Table variant="simple">
                <Thead
                  position="sticky"
                  top={0}
                  backgroundColor="white"
                  zIndex={1}
                >
                  <Tr>
                    <Th width="60px">Select</Th>
                    <Th>Document Name</Th>
                    <Th>Project</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {documents.map(([id, documentName, projectName]) => (
                    <Tr key={id} height="48px">
                      <Td>
                        <Checkbox
                          isChecked={selectedDocuments.has(id)}
                          onChange={() => handleToggleSelect(id)}
                        />
                      </Td>
                      <Td>
                        <TruncatedText>{documentName || "Untitled"}</TruncatedText>
                      </Td>
                      <Td>
                        <Badge
                          colorScheme={projectName === "Unassigned" ? "gray" : "blue"}
                          variant="subtle"
                        >
                          {projectName}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </ScrollableContainer>
          <Flex justifyContent="space-between" mt={4}>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleAddSelected}
              colorScheme="teal"
              isDisabled={selectedDocuments.size === 0}
            >
              Add Selected ({selectedDocuments.size})
            </Button>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
