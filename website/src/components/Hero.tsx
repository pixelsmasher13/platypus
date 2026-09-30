import { type FC } from "react";
import { Box, Container, Flex, Text, Heading, Button, HStack, Image, Link } from "@chakra-ui/react";
import { AppleIcon, WindowsIcon, GitHubIcon } from "./BrandIcons";
import { AppPreview } from "./AppPreview";
import { GITHUB_URL, useDownloadLinks } from "../links";

export const Hero: FC = () => {
  const downloads = useDownloadLinks();
  return (
    <Box
      bg="linear-gradient(180deg, #FAFAFA 0%, #FFFFFF 60%)"
      borderBottom="1px solid"
      borderColor="ink.100"
      pt={{ base: 6, md: 8 }}
      pb={{ base: 16, md: 20 }}
    >
      <Container maxW="7xl">
        {/* Nav */}
        <Flex align="center" mb={{ base: 14, md: 24 }} py={4}>
          <HStack spacing={2.5}>
            <Image src="/app-icon.png" alt="Platypus" boxSize="28px" borderRadius="6px" />
            <Text fontWeight="700" fontSize="md" letterSpacing="-0.01em">
              Platypus
            </Text>
          </HStack>
          <HStack spacing={7} ml="auto" display={{ base: "none", md: "flex" }}>
            <Link href="#features" fontSize="sm" color="ink.600" _hover={{ color: "ink.900", textDecoration: "none" }}>
              Features
            </Link>
            <Link href="#faq" fontSize="sm" color="ink.600" _hover={{ color: "ink.900", textDecoration: "none" }}>
              FAQ
            </Link>
            <Link
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              fontSize="sm"
              color="ink.600"
              _hover={{ color: "ink.900", textDecoration: "none" }}
              display="flex"
              alignItems="center"
              gap={1.5}
            >
              <GitHubIcon size={14} /> GitHub
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

        {/* Hero copy */}
        <Box textAlign="center" maxW="4xl" mx="auto" mb={{ base: 12, md: 16 }}>
          <Heading
            as="h1"
            fontSize={{ base: "44px", md: "72px" }}
            fontWeight="700"
            letterSpacing="-0.035em"
            lineHeight={1.02}
            mb={6}
            color="ink.900"
          >
            The best way to take notes
            <br />
            and organize your knowledge
          </Heading>
          <Text
            fontSize={{ base: "lg", md: "xl" }}
            color="ink.600"
            mb={10}
            maxW="2xl"
            mx="auto"
            lineHeight={1.5}
            letterSpacing="-0.005em"
          >
            Meeting transcription, note taking and document organization — reimagined for the era of AI. Completely free.
          </Text>

          <HStack spacing={3} justify="center" flexWrap="wrap">
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
              px={7}
              h="52px"
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
              bg="white"
              _hover={{ bg: "ink.50", borderColor: "ink.300" }}
              borderRadius="full"
              px={7}
              h="52px"
              fontSize="md"
              leftIcon={<WindowsIcon size={16} />}
            >
              Download for Windows
            </Button>
          </HStack>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            mt={5}
            display="inline-flex"
            alignItems="center"
            gap={2}
            fontSize="sm"
            color="ink.500"
            _hover={{ color: "ink.800", textDecoration: "none" }}
          >
            <GitHubIcon size={14} />
            Star on GitHub
          </Link>
        </Box>

        {/* App preview */}
        <Box maxW="6xl" mx="auto" px={{ base: 0, md: 4 }}>
          <Box display={{ base: "block", md: "none" }}>
            <AppPreview state="story" height="440px" />
          </Box>
          <Box display={{ base: "none", md: "block" }}>
            <AppPreview state="story" height="560px" />
          </Box>
        </Box>
      </Container>
    </Box>
  );
};
