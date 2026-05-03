import React, { FC, ReactNode } from "react";
import {
  Box,
  OrderedList,
  UnorderedList,
  ListItem,
  Heading,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import styled from "styled-components";
import { MessageMarkdownMemoized } from "./message-markdown-memoized";
import { MessageCodeBlock } from "./message-codeblock";
import type { ChunkSource } from "../../types";

interface MessageMarkdownProps {
  content: string;
  textColor?: string;
  sources?: ChunkSource[];
  onCitationClick?: (source: ChunkSource) => void;
}

// Matches `[1]`, `[12]`, `[1,2]`, `[1, 2, 3]`. Adjacent forms like `[1][2]`
// are matched as two separate hits because `]` ends each capture.
const CITATION_REGEX = /\[(\d+(?:[,\s]+\d+)*)\]/g;

const CitationChip = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin: 0 2px;
  border-radius: 9px;
  border: none;
  background: rgba(99, 102, 241, 0.15);
  color: var(--accent-color, #6366f1);
  font-size: 11px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  vertical-align: baseline;
  line-height: 1;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(99, 102, 241, 0.3);
  }
`;

/**
 * Walk react-markdown children and replace `[n]` tokens in text nodes with
 * clickable citation chips. Non-text nodes pass through untouched, so the
 * regex never runs against code blocks or rendered HTML.
 *
 * `[n]` numbers are 1-indexed and map to `sources[n-1]`. Numbers outside the
 * sources range render as plain text (the model occasionally invents indices
 * we don't have).
 */
function renderWithCitations(
  children: ReactNode,
  sources: ChunkSource[] | undefined,
  onClick: ((source: ChunkSource) => void) | undefined
): ReactNode {
  if (!sources || sources.length === 0 || !onClick) return children;

  const transform = (node: ReactNode, keyPrefix: string): ReactNode => {
    if (typeof node !== "string") return node;

    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    CITATION_REGEX.lastIndex = 0;

    while ((match = CITATION_REGEX.exec(node)) !== null) {
      if (match.index > lastIndex) {
        parts.push(node.slice(lastIndex, match.index));
      }
      const numbers = match[1]
        .split(/[,\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n));

      numbers.forEach((n, idx) => {
        const source = sources[n - 1];
        if (source) {
          const tooltipLabel = `${source.document_name} — ${source.chunk_preview}`;
          parts.push(
            <Tooltip
              key={`${keyPrefix}-${match!.index}-${n}-${idx}`}
              label={tooltipLabel}
              placement="top"
              hasArrow
              maxW="320px"
            >
              <CitationChip
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClick(source);
                }}
                aria-label={`View source ${n}: ${source.document_name}`}
              >
                {n}
              </CitationChip>
            </Tooltip>
          );
        } else {
          // Stale or invented index — render as plain text so it's at least visible.
          parts.push(`[${n}]`);
        }
      });

      lastIndex = match.index + match[0].length;
    }

    if (parts.length === 0) return node;
    if (lastIndex < node.length) parts.push(node.slice(lastIndex));
    return <>{parts}</>;
  };

  return React.Children.map(children, (child, i) => transform(child, `c${i}`));
}

export const MessageMarkdown: FC<MessageMarkdownProps> = ({
  content,
  textColor = "black",
  sources,
  onCitationClick,
}) => {
  const linkify = (children: ReactNode) =>
    renderWithCitations(children, sources, onCitationClick);

  return (
    <MessageMarkdownMemoized
      components={{
        p({ children }) {
          return (
            <Box mb={2} _last={{ mb: 0 }}>
              <Text color={textColor}>{linkify(children)}</Text>
            </Box>
          );
        },
        ol({ children }) {
          return (
            <OrderedList pl={4} mb={4}>
              {children}
            </OrderedList>
          );
        },
        ul({ children }) {
          return (
            <UnorderedList pl={4} mb={4}>
              {children}
            </UnorderedList>
          );
        },
        li({ children }) {
          return <ListItem>{linkify(children)}</ListItem>;
        },
        h1({ children }) {
          return (
            <Heading as="h1" size="md" mb={4}>
              {linkify(children)}
            </Heading>
          );
        },
        h2({ children }) {
          return (
            <Heading as="h2" size="md" mb={3}>
              {linkify(children)}
            </Heading>
          );
        },
        h3({ children }) {
          return (
            <Heading as="h3" size="md" mb={2}>
              {linkify(children)}
            </Heading>
          );
        },
        strong({ children }) {
          return <strong>{linkify(children)}</strong>;
        },
        em({ children }) {
          return <em>{linkify(children)}</em>;
        },
        code({ node, className, children, ...props }) {
          const childArray = React.Children.toArray(children);
          const firstChild = childArray[0] as React.ReactElement;
          const firstChildAsString = React.isValidElement(firstChild)
            ? (firstChild as React.ReactElement).props.children
            : firstChild;

          if (firstChildAsString === "▍") {
            return <span className="mt-1 animate-pulse cursor-default">▍</span>;
          }

          if (typeof firstChildAsString === "string") {
            childArray[0] = firstChildAsString.replace("`▍`", "▍");
          }

          const match = /language-(\w+)/.exec(className || "");
          if (
            typeof firstChildAsString === "string" &&
            !firstChildAsString.includes("\n")
          ) {
            return (
              <code className={className} {...props}>
                {childArray}
              </code>
            );
          }
          return (
            <MessageCodeBlock
              key={Math.random()}
              language={(match && match[1]) || ""}
              value={String(childArray).replace(/\n$/, "")}
              {...props}
            />
          );
        },
      }}
    >
      {content}
    </MessageMarkdownMemoized>
  );
};
