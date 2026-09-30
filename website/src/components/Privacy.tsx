import { type FC } from "react";
import { Box, Container, Heading, Text, VStack, Flex, HStack, Image, Link, Button } from "@chakra-ui/react";
import { AppleIcon } from "./BrandIcons";
import { useDownloadLinks } from "../links";

const Section: FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <VStack align="flex-start" spacing={3}>
    <Heading
      as="h2"
      fontSize={{ base: "xl", md: "2xl" }}
      fontWeight="700"
      letterSpacing="-0.02em"
      color="ink.900"
    >
      {title}
    </Heading>
    <Box color="ink.700" fontSize="md" lineHeight={1.7}>
      {children}
    </Box>
  </VStack>
);

export const Privacy: FC = () => {
  const downloads = useDownloadLinks();
  return (
    <>
      {/* Nav */}
      <Box bg="white" borderBottom="1px solid" borderColor="ink.100">
        <Container maxW="7xl">
          <Flex align="center" py={4}>
            <Link href="#" _hover={{ textDecoration: "none" }}>
              <HStack spacing={2.5}>
                <Image src="/app-icon.png" alt="Platypus" boxSize="28px" borderRadius="6px" />
                <Text fontWeight="700" fontSize="md" letterSpacing="-0.01em" color="ink.900">
                  Platypus
                </Text>
              </HStack>
            </Link>
            <HStack spacing={7} ml="auto" display={{ base: "none", md: "flex" }}>
              <Link
                href="#"
                fontSize="sm"
                color="ink.600"
                _hover={{ color: "ink.900", textDecoration: "none" }}
              >
                Home
              </Link>
              <Button
                as="a"
                href={downloads.mac}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                bg="ink.900"
                color="white"
                _hover={{ bg: "ink.800" }}
                borderRadius="full"
                px={5}
                leftIcon={<AppleIcon size={14} />}
              >
                Download
              </Button>
            </HStack>
          </Flex>
        </Container>
      </Box>

      <Box bg="white" py={{ base: 12, md: 20 }}>
        <Container maxW="3xl">
          <VStack align="flex-start" spacing={3} mb={12}>
            <Heading
              as="h1"
              fontSize={{ base: "4xl", md: "6xl" }}
              fontWeight="700"
              letterSpacing="-0.035em"
              lineHeight={1.05}
              color="ink.900"
            >
              Privacy Policy
            </Heading>
            <Text fontSize="md" color="ink.500">
              Last updated April 2, 2026
            </Text>
          </VStack>

          <VStack align="stretch" spacing={10}>
            <Box color="ink.700" fontSize="md" lineHeight={1.7}>
              At Heelix Technologies Inc., we respect your concerns about privacy. This Privacy Policy describes the
              types of personal information we collect about our users, how we use it, with whom we share it, the
              choices available to you, and how we protect your information.
            </Box>

            <Section title="Information handling in our chat service">
              When you use the chat service inside Platypus, the information you provide is passed directly to your
              chosen third-party LLM provider for processing. We do not store or retain any of the data you enter on
              our servers. Note that chat data may be stored on your device.
            </Section>

            <Section title="Local transcription stays local">
              When you record a meeting using local transcription, your audio is processed entirely on your device by
              the on-device Whisper model. Audio data never leaves your machine and is never transmitted to our servers
              or any third party.
            </Section>

            <Section title="Third-party LLM providers">
              You choose which LLM provider Platypus connects to (OpenAI, Anthropic, Google, or a local model). The
              handling of any data sent to that provider is subject to their own privacy policy. We encourage you to
              review the policy of whichever provider you connect.
            </Section>

            <Section title="Data retention">
              As we do not store chat or transcription data on our servers, we have no specific retention period for
              this information. Notes, recordings, and transcripts may be stored on your device, subject to your
              device's storage policies and settings.
            </Section>

            <Section title="Children's privacy">
              Our service is not intended for use by children under the age of 13. We do not knowingly collect personal
              information from children under 13. If we become aware that a child under 13 has provided us with personal
              information, we will take steps to delete it.
            </Section>

            <Section title="Your rights and choices">
              Because we do not store chat data on our servers, we are unable to directly access, correct, amend, or
              delete information processed in the chat. You can manage data stored on your device through the
              application's settings and your device's controls.
            </Section>

            <Section title="Updates to this notice">
              This Privacy Policy may be updated periodically without prior notice to reflect changes in our personal
              information practices. For major changes, we will notify you by posting a prominent notice on our website
              and by updating the date at the top of this notice.
            </Section>

            <Section title="Contact">
              Questions about this policy?{" "}
              <Link color="teal.600" href="mailto:hello@platypusnotes.com">
                hello@platypusnotes.com
              </Link>
            </Section>
          </VStack>
        </Container>
      </Box>
    </>
  );
};
