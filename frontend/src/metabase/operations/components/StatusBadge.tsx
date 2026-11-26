import { Badge, Group, Icon } from "metabase/ui";
import type { IconName } from "metabase/ui";

interface StatusConfig {
  color: string;
  icon: IconName;
  label: string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  "Fully covered": {
    color: "green",
    icon: "check",
    label: "Fully covered",
  },
  "Partially covered": {
    color: "yellow",
    icon: "warning",
    label: "Partially covered",
  },
  "Needs attention": {
    color: "red",
    icon: "warning",
    label: "Needs attention",
  },
  "No allocation": {
    color: "red",
    icon: "close",
    label: "Needs attention",
  },
  "Not planned": {
    color: "gray",
    icon: "clock",
    label: "Not planned",
  },
  "Outside current horizon": {
    color: "gray",
    icon: "info",
    label: "Outside current horizon",
  },
  "Data unavailable": {
    color: "gray",
    icon: "info",
    label: "Data unavailable",
  },
};

export function StatusBadge({ status }: { status?: string | null }) {
  const cfg = STATUS_MAP[status || ""] ?? {
    color: "gray",
    icon: "info" as IconName,
    label: status || "Unknown",
  };
  return (
    <Badge color={cfg.color} variant="light" size="sm" radius="sm">
      <Group gap={4} wrap="nowrap">
        <Icon name={cfg.icon} size={12} />
        <span>{cfg.label}</span>
      </Group>
    </Badge>
  );
}
