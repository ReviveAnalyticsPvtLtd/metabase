import { Badge, Group, Icon } from "metabase/ui";
import type { IconName } from "metabase-types/api";

interface StatusConfig {
  bg: string;
  fg: string;
  border: string;
  icon: IconName;
  label: string;
}

const STATUS_MAP: Record<string, StatusConfig> = {
  "Fully covered": {
    bg: "#E6F4EA",
    fg: "#137333",
    border: "#CEEAD6",
    icon: "check",
    label: "Fully covered",
  },
  "Partially covered": {
    bg: "#FEF7E0",
    fg: "#B06000",
    border: "#FEEFC3",
    icon: "warning",
    label: "Partially covered",
  },
  "Needs attention": {
    bg: "#FCE8E6",
    fg: "#C5221F",
    border: "#FAD2CF",
    icon: "warning",
    label: "Needs attention",
  },
  "No allocation": {
    bg: "#FCE8E6",
    fg: "#C5221F",
    border: "#FAD2CF",
    icon: "close",
    label: "Needs attention",
  },
  "Not planned": {
    bg: "#F1F3F4",
    fg: "#3C4043",
    border: "#DADCE0",
    icon: "clock",
    label: "Not planned",
  },
  "Outside current horizon": {
    bg: "#F1F3F4",
    fg: "#3C4043",
    border: "#DADCE0",
    icon: "info",
    label: "Outside current horizon",
  },
  "Data unavailable": {
    bg: "#F1F3F4",
    fg: "#3C4043",
    border: "#DADCE0",
    icon: "info",
    label: "Data unavailable",
  },
};

export function StatusBadge({ status }: { status?: string | null }) {
  const cfg = STATUS_MAP[status || ""] ?? {
    bg: "#F1F3F4",
    fg: "#3C4043",
    border: "#DADCE0",
    icon: "info",
    label: status || "Unknown",
  };
  return (
    <Badge
      size="sm"
      radius="sm"
      style={{
        backgroundColor: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        textTransform: "none",
      }}
    >
      <Group gap={4} wrap="nowrap">
        <Icon name={cfg.icon} size={12} />
        <span>{cfg.label}</span>
      </Group>
    </Badge>
  );
}
