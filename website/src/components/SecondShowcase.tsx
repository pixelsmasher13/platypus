import { type FC } from "react";
import { Box, Container, Grid, Heading, Text, VStack, HStack, Flex } from "@chakra-ui/react";
import { Mic, NotebookPen, Search, FolderInput } from "lucide-react";
import { AppPreview } from "./AppPreview";

const ITEMS = [
  {
    icon: Mic,
    title: "Transcribe meetings live",
    desc: "Live drafts while you talk, finalized locally with Whisper.",
    color: "red",
  },
  {
    icon: NotebookPen,
    title: "Organize meeting notes",
    desc: "Turn rough notes into decisions and next steps.",
    color: "purple",
  },
  {
    icon: Search,
    title: "Query your docs",
    desc: "Ask questions across a project, with links back to your notes.",
    color: "blue",
  },
  {
    icon: FolderInput,
    title: "Tag to projects",
    desc: "Move any note into any project with a single click.",
    color: "teal",
  },
];

export const SecondShowcase: FC = () => {
  return (
    <Box py={{ base: 20, md: 28 }} bg="white">
      <Container maxW="7xl">
        <Grid
          templateColumns={{ base: "1fr", lg: "minmax(0, 1fr) minmax(0, 1.2fr)" }}
          gap={{ base: 12, lg: 20 }}
          alignItems="center"
        >
          <VStack align="flex-start" spacing={6}>
            <Text
              fontSize="sm"
              fontWeight="600"
              color="teal.600"
              letterSpacing="0.08em"
              textTransform="uppercase"
            >
              One app, your whole workflow
            </Text>
            <Heading
              fontSize={{ base: "3xl", md: "5xl" }}
              fontWeight="700"
              letterSpacing="-0.03em"
              lineHeight={1.05}
              color="ink.900"
            >
              Fastest way to organize your knowledge
            </Heading>
            <Text fontSize="lg" color="ink.600" lineHeight={1.55}>
              Transcribe and summarize meetings. Clean up your notes. Query your docs. Tag to projects with a click.
            </Text>

            <VStack align="flex-start" spacing={5} pt={4} w="full">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <HStack key={item.title} spacing={4} align="flex-start">
                    <Flex
                      w="40px"
                      h="40px"
                      borderRadius="xl"
                      bg={`${item.color}.50`}
                      color={`${item.color}.600`}
                      align="center"
                      justify="center"
                      flexShrink={0}
                    >
                      <Icon size={18} strokeWidth={2.2} />
                    </Flex>
                    <Box>
                      <Text fontWeight="600" fontSize="md" color="ink.900" letterSpacing="-0.01em">
                        {item.title}
                      </Text>
                      <Text fontSize="sm" color="ink.600" mt={0.5}>
                        {item.desc}
                      </Text>
                    </Box>
                  </HStack>
                );
              })}
            </VStack>
          </VStack>

          <Box>
            <Box display={{ base: "block", md: "none" }}>
              <AppPreview state="note" height="420px" />
            </Box>
            <Box display={{ base: "none", md: "block" }}>
              <AppPreview state="note" height="540px" />
            </Box>
          </Box>
        </Grid>
      </Container>
    </Box>
  );
};
