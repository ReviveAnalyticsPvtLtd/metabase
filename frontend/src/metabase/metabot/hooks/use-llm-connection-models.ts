import { useMemo } from "react";

import { useListLlmModelsQuery } from "metabase/api";
import type { LlmConnectionModels } from "metabase-types/api";

export function useLlmConnectionModels() {
  const { data: connections = [], isLoading, error } = useListLlmModelsQuery();

  const modelOptions = useMemo(
    () => getModelOptions(connections),
    [connections],
  );

  const errorByConnectionKey = useMemo(
    () => getErrorByConnectionKey(connections),
    [connections],
  );

  const modelNameByRef = useMemo(
    () => getModelNameByRef(connections),
    [connections],
  );

  return {
    connections,
    modelOptions,
    modelNameByRef,
    errorByConnectionKey,
    isLoading,
    error,
  };
}

// The label is what a closed Select shows, and a model name alone does not say which provider
// serves it. The dropdown renders [[modelNameByRef]] instead, where the group heading already does.
function getModelOptions(connections: LlmConnectionModels[]) {
  const seenValues = new Set<string>();

  return (connections || [])
    .filter((connection) => (connection?.models || []).length > 0)
    .map((connection) => {
      const items: Array<{ value: string; label: string }> = [];

      for (const model of connection?.models || []) {
        if (!model?.id) {
          continue;
        }
        const value = `${connection.key}/${model.id}`;
        if (!seenValues.has(value)) {
          seenValues.add(value);
          items.push({
            value,
            label: `${connection.name} · ${model.display_name || model.id}`,
          });
        }
      }

      return {
        group: connection.name,
        items,
      };
    })
    .filter((group) => group.items.length > 0);
}

function getModelNameByRef(connections: LlmConnectionModels[]) {
  const result: Record<string, string> = {};
  for (const connection of connections || []) {
    for (const model of connection?.models || []) {
      if (model?.id) {
        const key = `${connection.key}/${model.id}`;
        if (!result[key]) {
          result[key] = model.display_name || model.id;
        }
      }
    }
  }
  return result;
}

function getErrorByConnectionKey(connections: LlmConnectionModels[]) {
  const entries = (connections || []).flatMap((connection) =>
    connection?.error ? [[connection.key, connection.error] as const] : [],
  );
  return Object.fromEntries(entries);
}
