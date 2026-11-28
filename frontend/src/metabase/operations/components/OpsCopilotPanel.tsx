import { useState } from "react";
import { t } from "ttag";

import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Icon,
  Text,
  TextInput,
  Title,
} from "metabase/ui";

import { askOpsAssistant } from "../api";
import type { OpsAssistantResponse } from "../types";

export function OpsCopilotPanel({
  orderId,
  compact = false,
}: {
  orderId?: string;
  compact?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<OpsAssistantResponse | null>(null);

  const quickPrompts = orderId
    ? [
        t`Why was this source selected instead of other options?`,
        t`Why use a Brewer instead of a depot, or why is it uncovered?`,
        t`What changes if I choose the next alternative?`,
        t`Which data is missing for this plan?`,
      ]
    : [
        t`Summarize the active plan coverage and top bottlenecks.`,
        t`Why are some orders uncovered in the current horizon?`,
        t`How does Service-First Fallback compare to strict depot-only?`,
      ];

  const handleAsk = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed) {
      return;
    }
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    try {
      const res = await askOpsAssistant({
        question: trimmed,
        order_id: orderId,
      });
      setReply(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t`Could not get AI Copilot response.`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      p={compact ? "sm" : "md"}
      mb="md"
      style={{
        border: "1px solid var(--mb-color-border)",
        borderRadius: 10,
        backgroundColor: "var(--mb-color-background-primary)",
      }}
      data-testid="ops-ai-copilot"
    >
      <Flex justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
        <Group gap="xs">
          <Icon name="insight" size={16} c="brand" />
          <Title order={5}>{t`Plan explanation`}</Title>
          <Text size="xs" c="text-secondary">
            {t`Deterministic, solver-backed Operations decision support. No external AI is used.`}
          </Text>
        </Group>
      </Flex>

      <Group gap="xs" mb="sm" wrap="wrap">
        {quickPrompts.map((p) => (
          <Button
            key={p}
            size="xs"
            variant="default"
            disabled={loading}
            onClick={() => handleAsk(p)}
          >
            {p}
          </Button>
        ))}
      </Group>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk(question);
        }}
      >
        <Flex gap="xs" align="center">
          <TextInput
            placeholder={
              orderId
                ? t`Ask about ${orderId}, alternatives, or deadline feasibility...`
                : t`Ask about coverage, shortfalls, depots, or carriers...`
            }
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button type="submit" loading={loading} size="sm">
            {t`Ask`}
          </Button>
        </Flex>
      </form>

      {error && (
        <Text size="xs" c="error" mt="xs">
          {error}
        </Text>
      )}

      {reply && (
        <Box
          p="sm"
          mt="sm"
          style={{
            borderRadius: 8,
            backgroundColor: "var(--mb-color-background-secondary)",
            border: "1px solid var(--mb-color-border)",
          }}
        >
          <Text size="sm" style={{ lineHeight: 1.5 }}>
            {reply.answer}
          </Text>
          {reply.cited_ids && reply.cited_ids.length > 0 && (
            <Group gap="xs" mt="xs" wrap="wrap">
              <Text size="xs" c="text-secondary">{t`Evidence IDs:`}</Text>
              {reply.cited_ids.map((cid) => (
                <Badge
                  key={cid}
                  size="xs"
                  style={{
                    backgroundColor: "#F1F3F4",
                    color: "#3C4043",
                    border: "1px solid #DADCE0",
                    textTransform: "none",
                  }}
                >
                  {cid}
                </Badge>
              ))}
            </Group>
          )}
        </Box>
      )}
    </Box>
  );
}
