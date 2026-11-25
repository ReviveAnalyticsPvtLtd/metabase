import { useMemo, useState } from "react";
import { t } from "ttag";

import {
  skipToken,
  useListCardsQuery,
  useListCollectionsQuery,
  useListDashboardsQuery,
} from "metabase/api";
import CreateCollectionModal from "metabase/common/collections/containers/CreateCollectionModal";
import {
  currentUserPersonalCollections,
  isExamplesCollection,
  isLibraryCollection,
  isRootTrashCollection,
  nonPersonalOrArchivedCollection,
} from "metabase/common/collections/utils";
import { Link } from "metabase/common/components/Link";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { getUser } from "metabase/current-user";
import { useSelector } from "metabase/redux";
import { useNavigate, useSearchParams } from "metabase/router";
import {
  Button,
  Card,
  Ellipsified,
  FixedSizeIcon,
  Flex,
  Icon,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import type {
  Card as CardItem,
  Collection,
  ListDashboardsResponse,
} from "metabase-types/api";

/**
 * Power BI-style Workspaces landing page (part of the `pbi` navigation
 * experience). Terminology parity is UI-only:
 *
 * - Workspaces       = collections
 * - Reports          = dashboards
 * - Semantic models  = model cards
 * - Queries          = question cards
 * - Automations      = scheduled reports and alerts (no list API yet, so the
 *                      tab shows an empty state until one exists)
 *
 * The resource tabs aggregate across the whole instance for now; Power BI
 * scopes them per-workspace. The rail's workspace tree remains the
 * per-workspace entry point.
 */

export type WorkspaceTabId =
  | "reports"
  | "semanticModels"
  | "queries"
  | "automations";

export const WORKSPACE_TABS: Array<{
  id: WorkspaceTabId;
  get label(): string;
}> = [
  {
    id: "reports",
    get label() {
      return t`Reports`;
    },
  },
  {
    id: "semanticModels",
    get label() {
      return t`Semantic models`;
    },
  },
  {
    id: "queries",
    get label() {
      return t`Queries`;
    },
  },
  {
    id: "automations",
    get label() {
      return t`Automations`;
    },
  },
];

const DEFAULT_TAB: WorkspaceTabId = "reports";

const CARD_ICONS: Record<"model" | "question", "model" | "sql"> = {
  model: "model",
  question: "sql",
};

export function WorkspacesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modal, setModal] = useState<"MODAL_NEW_COLLECTION" | null>(null);

  const tab = getTab(searchParams.get("tab"));
  const currentUser = useSelector(getUser);

  const {
    data: collections = [],
    isLoading: collectionsLoading,
    error: collectionsError,
  } = useListCollectionsQuery();

  // Fetch only what the active tab needs; `skipToken` avoids loading the
  // whole content corpus on page entry.
  const showCards = tab === "semanticModels" || tab === "queries";
  const cardsQuery = useListCardsQuery(showCards ? undefined : skipToken);
  const dashboardsQuery = useListDashboardsQuery(
    tab === "reports" ? undefined : skipToken,
  );

  const workspaces = useMemo((): Collection[] => {
    if (!currentUser) {
      return [];
    }

    const personalCollections = currentUserPersonalCollections(
      collections,
      currentUser.id,
    );
    const displayableCollections = collections.filter(
      (item) =>
        nonPersonalOrArchivedCollection(item) &&
        !isRootTrashCollection(item) &&
        !isExamplesCollection(item) &&
        !isLibraryCollection(item),
    );

    return [...displayableCollections, ...personalCollections];
  }, [collections, currentUser]);

  if (collectionsError) {
    return <LoadingAndErrorWrapper error={collectionsError} loading={false} />;
  }

  return (
    <Stack p="xl" gap="lg" data-testid="workspaces-page">
      <Flex justify="space-between" align="center" gap="lg">
        <Title order={1}>{t`Workspaces`}</Title>
        <Button
          variant="filled"
          onClick={() => setModal("MODAL_NEW_COLLECTION")}
          aria-label={t`New workspace`}
        >
          <Icon name="add" mr="sm" />
          {t`New workspace`}
        </Button>
      </Flex>

      <Flex gap="sm" align="center">
        {WORKSPACE_TABS.map(({ id, label }) => (
          <Button
            key={id}
            variant={tab === id ? "filled" : "transparent"}
            onClick={() => setSelectTab(searchParams, setSearchParams, id)}
            data-testid={`${id}-tab`}
          >
            {label}
          </Button>
        ))}
      </Flex>

      <WorkspaceTabContent
        tab={tab}
        cards={(cardsQuery.data ?? []).filter(
          (card) =>
            card.type === (tab === "semanticModels" ? "model" : "question"),
        )}
        cardsLoading={cardsQuery.isLoading}
        cardsError={cardsQuery.error}
        dashboards={dashboardsQuery.data ?? []}
        dashboardsLoading={dashboardsQuery.isLoading}
        dashboardsError={dashboardsQuery.error}
      />

      <Title order={3} mt="lg">
        {t`Workspaces`}
      </Title>

      {collectionsLoading ? (
        <LoadingAndErrorWrapper loading />
      ) : workspaces.length === 0 ? (
        <Text c="text-secondary">{t`No workspaces yet.`}</Text>
      ) : (
        <SimpleGrid
          cols={{ "20rem": 1, "40rem": 2, "60rem": 3 }}
          type="container"
          w="100%"
        >
          {workspaces.map((workspace) => (
            <WorkspaceCard key={String(workspace.id)} item={workspace} />
          ))}
        </SimpleGrid>
      )}

      {modal === "MODAL_NEW_COLLECTION" && (
        <CreateCollectionModal
          onClose={() => setModal(null)}
          onCreate={(collection) => {
            setModal(null);
            navigate(Urls.collection(collection));
          }}
        />
      )}
    </Stack>
  );
}

function WorkspaceTabContent({
  tab,
  cards,
  cardsLoading,
  cardsError,
  dashboards,
  dashboardsLoading,
  dashboardsError,
}: {
  tab: WorkspaceTabId;
  cards: CardItem[];
  cardsLoading: boolean;
  cardsError?: unknown;
  dashboards: ListDashboardsResponse;
  dashboardsLoading: boolean;
  dashboardsError?: unknown;
}) {
  if (tab === "reports") {
    if (dashboardsLoading || dashboardsError) {
      return (
        <LoadingAndErrorWrapper
          loading={dashboardsLoading}
          error={dashboardsError}
        />
      );
    }

    return dashboards.length === 0 ? (
      <Text c="text-secondary" data-testid="empty-state">
        {t`No reports yet. Create a report from a workspace.`}
      </Text>
    ) : (
      <SimpleGrid
        cols={{ "20rem": 1, "40rem": 2, "60rem": 3 }}
        type="container"
        w="100%"
      >
        {dashboards.map((dashboard) => (
          <ResourceCard
            key={dashboard.id}
            icon="dashboard"
            title={dashboard.name}
            to={Urls.dashboard({ id: dashboard.id, name: dashboard.name })}
          />
        ))}
      </SimpleGrid>
    );
  }

  if (tab === "semanticModels" || tab === "queries") {
    if (cardsLoading || cardsError) {
      return (
        <LoadingAndErrorWrapper loading={cardsLoading} error={cardsError} />
      );
    }

    const type = tab === "semanticModels" ? "model" : "question";
    const emptyMessage =
      tab === "semanticModels"
        ? t`No semantic models yet.`
        : t`No queries yet.`;

    return cards.length === 0 ? (
      <Text c="text-secondary" data-testid="empty-state">
        {emptyMessage}
      </Text>
    ) : (
      <SimpleGrid
        cols={{ "20rem": 1, "40rem": 2, "60rem": 3 }}
        type="container"
        w="100%"
      >
        {cards.map((card) => (
          <ResourceCard
            key={card.id}
            icon={CARD_ICONS[type]}
            title={card.name}
            // Keep the routing table authoritative: "/model/:id" for models,
            // "/question/:id" for questions.
            to={`${type === "model" ? "/model" : "/question"}/${card.id}`}
          />
        ))}
      </SimpleGrid>
    );
  }

  return (
    <Text c="text-secondary" data-testid="empty-state">
      {t`Automations keep workspaces fresh on a schedule. Scheduled reports and alerts live in each report's sharing menu for now.`}
    </Text>
  );
}

function ResourceCard({
  icon,
  title,
  to,
}: {
  icon: "dashboard" | "folder" | "model" | "sql";
  title: string;
  to: string;
}) {
  return (
    <Card component={Link} to={to} withBorder radius="md">
      <Flex align="center" gap="sm">
        <FixedSizeIcon name={icon} size={20} color="core-brand" />
        <Ellipsified>{title}</Ellipsified>
      </Flex>
    </Card>
  );
}

function WorkspaceCard({ item }: { item: Collection }) {
  return (
    <ResourceCard icon="folder" title={item.name} to={Urls.collection(item)} />
  );
}

function getTab(value: string | null): WorkspaceTabId {
  const active = WORKSPACE_TABS.find(({ id }) => id === value);
  return active ? active.id : DEFAULT_TAB;
}

function setSelectTab(
  searchParams: URLSearchParams,
  setSearchParams: (next: URLSearchParams) => void,
  tab: WorkspaceTabId,
): void {
  const next = new URLSearchParams(searchParams);
  next.set("tab", tab);
  setSearchParams(next);
}
