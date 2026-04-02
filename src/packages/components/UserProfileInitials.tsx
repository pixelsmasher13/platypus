import { FC, ReactNode } from "react";
import styled from "styled-components";
import { ConditionalWrapper } from "@platypus-app/components";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  Image,
} from "@chakra-ui/react";

const Wrapper = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
`;

const ImageAccent = styled.div`
  display: flex;
  width: 34px;
  height: 34px;
  background-color: var(--category-4-color);
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  cursor: pointer;
`;

const ImageHover = styled.div`
  &:hover {
    background-color: var(--secondary-hover-color);
  }
  display: flex;
  width: 40px;
  height: 40px;
  background-color: transparent;
  justify-content: center;
  border-radius: 50%;
  align-items: center;
`;

const UserBubble = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: #f0f0f0;
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
`;

const MenuContentContainer = styled.div`
  display: flex;
  flex-direction: column;
`;

type UserProfileInitialsProps = {
  picture: string;
  name: string;
  children?: ReactNode;
};
export const UserProfileInitials: FC<UserProfileInitialsProps> = ({
  picture,
  name,
  children,
}) => {
  const getInitials = () => {
    const nameSplit = name.split(" ");
    const firstInitial = nameSplit[0]?.[0] || "";
    const lastInitial = nameSplit[1]?.[0] || "";
    return `${firstInitial}${lastInitial}`;
  };
  return (
    <Wrapper>
      <ConditionalWrapper
        shouldWrap={!!children}
        wrapper={(localChildren) => (
          <Popover>
            <PopoverTrigger>{localChildren}</PopoverTrigger>

            {children && (
              <PopoverContent backgroundColor={"var(--page-background-color)"}>
                <PopoverBody>
                  <MenuContentContainer>{children}</MenuContentContainer>
                </PopoverBody>
              </PopoverContent>
            )}
          </Popover>
        )}
      >
        <ImageHover>
          <ImageAccent>
            <UserBubble>
              {picture ? <Image src={picture} /> : getInitials()}
            </UserBubble>
          </ImageAccent>
        </ImageHover>
      </ConditionalWrapper>
    </Wrapper>
  );
};
