import { type FC } from "react";
import { Box, Container, Heading, Text, Button, HStack, VStack } from "@chakra-ui/react";
import { AppleIcon, WindowsIcon } from "./BrandIcons";
import { useDownloadLinks } from "../links";

export const CTA: FC = () => {
  const downloads = useDownloadLinks();
  return (
    <Box bg="white" py={{ base: 24, md: 32 }} borderTop="1px solid" borderColor="ink.100">
      <Container maxW="3xl" textAlign="center">
        <VStack spacing={7}>
          <Heading
            fontSize={{ base: "4xl", md: "6xl" }}
            fontWeight="700"
            letterSpacing="-0.035em"
            lineHeight={1.05}
            color="ink.900"
          >
            Stop typing during meetings.
            <br />
            Start thinking again.
          </Heading>
          <Text fontSize="lg" color="ink.600" maxW="xl" lineHeight={1.55}>
            Platypus listens, transcribes locally, and turns rough recordings into clean notes — using whichever LLM you trust.
          </Text>
          <HStack spacing={3} pt={3} flexWrap="wrap" justify="center">
            <Button
              as="a"
              href={downloads.mac}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              bg="ink.900"
              color="white"
              _hover={{ bg: "ink.800" }}
              borderRadius="full"
              h="56px"
              px={8}
              fontSize="md"
              leftIcon={<AppleIcon size={18} />}
            >
              Download for Mac
            </Button>
            <Button
              as="a"
              href={downloads.windows}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              variant="outline"
              borderColor="ink.200"
              color="ink.800"
              _hover={{ bg: "ink.50", borderColor: "ink.300" }}
              borderRadius="full"
              h="56px"
              px={8}
              fontSize="md"
              leftIcon={<WindowsIcon size={16} />}
            >
              Download for Windows
            </Button>
          </HStack>
          <Text fontSize="xs" color="ink.500" pt={2}>
            Free forever · No account · Your audio never leaves your machine
          </Text>
        </VStack>
      </Container>
    </Box>
  );
};
