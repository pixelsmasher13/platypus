import { type FC } from "react";
import {
  Box,
  Container,
  Heading,
  Text,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Link,
} from "@chakra-ui/react";

const QA = [
  {
    q: "Why did you build Platypus?",
    a: "Existing meeting tools either send your audio to the cloud or lock you into a single LLM provider. Platypus runs transcription locally and lets you bring your own model — so you keep both privacy and choice.",
  },
  {
    q: "What system specs are required to run Platypus?",
    a: "Local transcription works best on Apple Silicon Macs (M1 or later) with at least 8GB RAM. On Intel Macs and Windows, you can use the OpenAI cloud transcription option instead. The app itself runs fine on any modern machine.",
  },
  {
    q: "Is Platypus free?",
    a: "Yes — completely free, including the source code. You only pay for whatever LLM you choose to connect (OpenAI, Anthropic, Gemini), or use a local model and pay nothing at all.",
  },
  {
    q: "Do I need to download a new app version periodically?",
    a: "Updates are released on GitHub. You can pull the latest binary whenever you want to get new features — there's no forced update cycle.",
  },
  {
    q: "What language models does Platypus currently support?",
    a: "OpenAI GPT-6 Astra, Sol and Luna, Anthropic Claude Sonnet 5, Opus 5.5 and Haiku 4.5, Google Gemini 3.8 Flash and 3.1 Pro, and any local model via Ollama or a compatible endpoint. Bring your own API key — you only pay your provider directly.",
  },
];

export const FAQ: FC = () => {
  return (
    <Box id="faq" bg="ink.50" py={{ base: 20, md: 28 }} scrollMarginTop="20px">
      <Container maxW="3xl">
        <Box textAlign="center" mb={12}>
          <Heading
            fontSize={{ base: "3xl", md: "5xl" }}
            fontWeight="700"
            letterSpacing="-0.03em"
            lineHeight={1.05}
            mb={4}
            color="ink.900"
          >
            Frequently asked
          </Heading>
          <Text fontSize="md" color="ink.600">
            If you still have questions, send us a message at{" "}
            <Link color="teal.600" href="mailto:hello@platypusnotes.com" fontWeight="500">
              hello@platypusnotes.com
            </Link>
          </Text>
        </Box>

        <Accordion allowToggle>
          {QA.map((item) => (
            <AccordionItem
              key={item.q}
              border="1px solid"
              borderColor="ink.200"
              borderRadius="xl"
              mb={3}
              bg="white"
              overflow="hidden"
            >
              <AccordionButton _hover={{ bg: "ink.50" }} px={6} py={5}>
                <Text flex="1" textAlign="left" fontWeight="600" fontSize="md" color="ink.900" letterSpacing="-0.01em">
                  {item.q}
                </Text>
                <AccordionIcon color="ink.400" />
              </AccordionButton>
              <AccordionPanel px={6} pb={6} pt={0}>
                <Text color="ink.600" fontSize="sm" lineHeight={1.7}>
                  {item.a}
                </Text>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </Box>
  );
};
