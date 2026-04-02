import { type FC } from "react";
import styled from "styled-components";
import { Text } from "@platypus-app/design";
const NewConversationContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: var(--space-l);
  justify-content: center;
`;

const PlatypusIcon = styled.div`
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #0d9488, #14b8a6);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: white;
  font-weight: 700;
  font-family: "Nunito", sans-serif;
`;

export const NewConversationMessage: FC = () => (
  <NewConversationContainer>
    <PlatypusIcon>P</PlatypusIcon>
    <Text type="m" bold>
      What's on your mind? Ask Platypus anything or start a new note
    </Text>
  </NewConversationContainer>
);
