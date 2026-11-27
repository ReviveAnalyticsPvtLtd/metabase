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
        t`Why was this source selected and why weren't cheaper or peer options used?`,
        t`What happens if we force the top alternative for ${orderId}?`,
        t`Summarize this order's deadline and shortfall risk for my manager.`,
      ]
    : [
        t`Summarize the Depot-First plan coverage and top bottlenecks.`,
        t`Why are some orders uncovered in the current horizon?`,
        t`How does Depot-First compare to the unrestricted nearest-source benchmark?`,
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
          <Icon name="insight" size={16} color="var(--mb-color-brand)" />
          <Title order={5}>{t`Nubrix Ops AI Copilot`}</Title>
          <Badge
            size="xs"
            style={{
              backgroundColor: "#E8F0FE",
              color: "#1967D2",
              border: "1px solid #D2E3FC",
              textTransform: "none",
            }}
          >
            {t`Deterministic local summary · No external AI`}
          </Badge>
        </Group>
        {reply && (
          <Text size="xs" c="text-secondary">
            {t`Local deterministic summary (external AI disabled)`}
          </Text>
        )}
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
            {t`Ask AI`}
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
        </Box>
      )}
    </Box>
  );
}
