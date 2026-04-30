import { type FC, type ReactNode } from "react";
import {
  Box,
  Flex,
  Text,
  CloseButton,
  Button,
  Spinner,
  useToast,
  type UseToastOptions,
} from "@chakra-ui/react";
import { CheckCircle2, AlertCircle, Info, type LucideIcon } from "lucide-react";

type Status = "info" | "success" | "error" | "loading";

const STATUS_STYLES: Record<
  Status,
  { accent: string; iconColor: string; bg: string; Icon: LucideIcon }
> = {
  info: { accent: "#3B82F6", iconColor: "#3B82F6", bg: "#EFF6FF", Icon: Info },
  success: { accent: "#10B981", iconColor: "#10B981", bg: "#ECFDF5", Icon: CheckCircle2 },
  error: { accent: "#EF4444", iconColor: "#EF4444", bg: "#FEF2F2", Icon: AlertCircle },
  loading: { accent: "#6366F1", iconColor: "#6366F1", bg: "#EEF2FF", Icon: Info },
};

type NotifyOptions = {
  title: string;
  description?: ReactNode;
  status?: Status;
  /** ms; null = sticky until dismissed */
  duration?: number | null;
  /** Optional inline action button */
  action?: { label: string; onClick: () => void };
};

const PrettyToast: FC<NotifyOptions & { onClose: () => void }> = ({
  title,
  description,
  status = "info",
  action,
  onClose,
}) => {
  const { accent, iconColor, bg, Icon } = STATUS_STYLES[status];
  return (
    <Box
      bg="white"
      borderRadius="lg"
      boxShadow="0 10px 25px -5px rgba(15,23,42,0.12), 0 4px 8px -2px rgba(15,23,42,0.06)"
      border="1px solid"
      borderColor="rgba(15,23,42,0.06)"
      overflow="hidden"
      maxW="380px"
      minW="320px"
    >
      <Flex>
        {/* Accent strip */}
        <Box w="4px" bg={accent} flexShrink={0} />

        <Flex flex={1} p={3} gap={3} align="flex-start">
          {/* Icon disc */}
          <Flex
            w="32px"
            h="32px"
            borderRadius="full"
            bg={bg}
            color={iconColor}
            align="center"
            justify="center"
            flexShrink={0}
            mt={0.5}
          >
            {status === "loading" ? <Spinner size="sm" color={iconColor} /> : <Icon size={16} />}
          </Flex>

          {/* Body */}
          <Flex direction="column" flex={1} minW={0} gap={action ? 2 : 0.5}>
            <Text fontSize="sm" fontWeight="600" color="gray.900" letterSpacing="-0.01em">
              {title}
            </Text>
            {description && (
              <Text fontSize="xs" color="gray.600" lineHeight={1.5}>
                {description}
              </Text>
            )}
            {action && (
              <Box>
                <Button
                  size="xs"
                  bg={accent}
                  color="white"
                  _hover={{ bg: accent, opacity: 0.9 }}
                  borderRadius="md"
                  onClick={() => {
                    action.onClick();
                    onClose();
                  }}
                  mt={1}
                >
                  {action.label}
                </Button>
              </Box>
            )}
          </Flex>

          <CloseButton size="sm" onClick={onClose} color="gray.400" _hover={{ color: "gray.700" }} />
        </Flex>
      </Flex>
    </Box>
  );
};

/**
 * Drop-in replacement for Chakra's useToast that renders a softer card-style
 * notification with optional action buttons. Returns a `notify(opts)` function.
 */
export function useNotify() {
  const toast = useToast();
  return (opts: NotifyOptions) => {
    const chakraOpts: UseToastOptions = {
      duration: opts.duration === undefined ? 4000 : opts.duration,
      isClosable: true,
      position: "bottom-right",
      render: ({ onClose }) => <PrettyToast {...opts} onClose={onClose} />,
    };
    toast(chakraOpts);
  };
}
