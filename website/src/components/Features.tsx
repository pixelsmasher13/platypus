import { type FC } from "react";
import { Box, Container, Grid, Heading, Text, VStack, Flex } from "@chakra-ui/react";
import { Lock, MessageSquare } from "lucide-react";
import { AppleIcon, WindowsIcon } from "./BrandIcons";

const FEATURES = [
  {
    title: "Desktop app for Mac and Windows",
    desc: "Built for lightning speed. Native performance, no Electron bloat. Less than 30MB on disk.",
    accent: "blue",
    visual: (
      <Flex align="center" gap={4} color="ink.700">
        <AppleIcon size={36} />
        <Box w="1px" h="24px" bg="ink.200" />
        <WindowsIcon size={32} />
      </Flex>
    ),
  },
  {
    title: "Local by design",
    desc: "Local transcription and vector DB stored only on your machine. Your conversations never leave your device.",
    accent: "teal",
    visual: (
      <Flex
        w="64px"
        h="64px"
        borderRadius="2xl"
        bg="linear-gradient(135deg, #99F6E4 0%, #14B8A6 100%)"
        align="center"
        justify="center"
        color="white"
        boxShadow="0 8px 24px -8px rgba(20, 184, 166, 0.4)"
      >
        <Lock size={28} strokeWidth={2.2} />
      </Flex>
    ),
  },
  {
    title: "Tap into your favorite LLM",
    desc: "Platypus connects to OpenAI, Anthropic Claude and Gemini — or run fully local models for total privacy.",
    accent: "purple",
    visual: (
      <Flex
        w="64px"
        h="64px"
        borderRadius="2xl"
        bg="linear-gradient(135deg, #DDD6FE 0%, #8B5CF6 100%)"
        align="center"
        justify="center"
        color="white"
        boxShadow="0 8px 24px -8px rgba(139, 92, 246, 0.4)"
      >
        <MessageSquare size={28} strokeWidth={2.2} />
      </Flex>
    ),
  },
];

export const Features: FC = () => {
  return (
    <Box id="features" bg="ink.50" py={{ base: 20, md: 28 }} borderTop="1px solid" borderColor="ink.100" scrollMarginTop="20px">
      <Container maxW="6xl">
        <Box textAlign="center" mb={16} maxW="3xl" mx="auto">
          <Text
            fontSize="sm"
            fontWeight="600"
            color="teal.600"
            mb={3}
            letterSpacing="0.08em"
            textTransform="uppercase"
          >
            Why Platypus
          </Text>
          <Heading
            fontSize={{ base: "3xl", md: "5xl" }}
            fontWeight="700"
            letterSpacing="-0.03em"
            lineHeight={1.05}
            mb={5}
            color="ink.900"
          >
            Built for speed and privacy
          </Heading>
          <Text fontSize="lg" color="ink.600" maxW="2xl" mx="auto" lineHeight={1.55}>
            Accurate local transcription, meeting summaries and local document retrieval — capture and analyze the
            information you need in one click.
          </Text>
        </Box>

        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap={5}>
          {FEATURES.map((f) => (
            <VStack
              key={f.title}
              align="flex-start"
              bg="white"
              p={8}
              borderRadius="2xl"
              border="1px solid"
              borderColor="ink.100"
              spacing={5}
              h="full"
              transition="all 0.2s"
              _hover={{ borderColor: "ink.200", transform: "translateY(-2px)" }}
            >
              {f.visual}
              <Heading fontSize="xl" fontWeight="600" letterSpacing="-0.02em" color="ink.900">
                {f.title}
              </Heading>
              <Text fontSize="sm" color="ink.600" lineHeight={1.65}>
                {f.desc}
              </Text>
            </VStack>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};
