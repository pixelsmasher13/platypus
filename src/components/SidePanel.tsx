import { ReactNode, type FC, type CSSProperties } from "react";

import styled from "styled-components";
import { Tabs, TabList, TabPanels, Tab, TabPanel } from "@chakra-ui/react";

// const Container = styled.div<{ gridArea: CSSProperties["gridArea"] }>`
//   grid-area: ${({ gridArea }) => gridArea};
// `;

const TabHeaderContent = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

type SidePanelProps = {
  gridArea: CSSProperties["gridArea"];
  pages: { text?: string; icon: ReactNode; content: ReactNode }[];
};
export const SidePanel: FC<SidePanelProps> = ({ pages, gridArea }) => {
  return (
    <Tabs
      variant={"soft-rounded"}
      colorScheme="gray"
      style={{
        gridArea,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <TabList style={{ padding: "12px", flexShrink: 0 }}>
        {pages.map((page) => (
          <Tab key={page.text}>
            <TabHeaderContent>
              {page.icon}
              {page.text}
            </TabHeaderContent>
          </Tab>
        ))}
      </TabList>
      <TabPanels style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {pages.map((page) => (
          <TabPanel key={page.text} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {page.content}
          </TabPanel>
        ))}
      </TabPanels>
    </Tabs>
  );
};
