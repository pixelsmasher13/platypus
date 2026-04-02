import type { FC, PropsWithChildren } from "react";
import { Grid, GridItem, Flex } from "@chakra-ui/react";
import { UserProfile } from "@platypus-app/components";

type NavigationProps = {} & PropsWithChildren;

export const Navigation: FC<NavigationProps> = ({ children }) => {
  return (
    <Grid
      height={"100%"}
      templateAreas={`"navheader" "content"`}
      gridTemplateRows={"70px 1fr"}
      color="blackAlpha.700"
      bg="var(--page-background-color)"
      fontWeight="bold"
    >
      <GridItem
        bg="white"
        borderBottom={"1px solid"}
        borderBottomColor={"gray.300"}
        area={"navheader"}
      >
        <Flex justifyContent={"space-between"} align={"center"}>
          <Flex p={2} gap={2} alignItems={"center"}>
            <UserProfile />
          </Flex>
        </Flex>
      </GridItem>
      <GridItem area={"content"} overflowY={"auto"}>
        {children}
      </GridItem>
    </Grid>
  );
};
