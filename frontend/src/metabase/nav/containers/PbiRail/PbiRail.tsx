import { useKBar } from "kbar";
import type { MouseEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { t } from "ttag";

import ErrorBoundary from "metabase/ErrorBoundary";
import {
  useGetCollectionQuery,
  useListBookmarksQuery,
  useListCollectionsTreeQuery,
  useReorderBookmarksMutation,
} from "metabase/api";
import { ROOT_COLLECTION } from "metabase/common/collections/constants";
import CreateCollectionModal from "metabase/common/collections/containers/CreateCollectionModal";
import type { CollectionTreeItem } from "metabase/common/collections/utils";
import {
  buildCollectionTree,
  coerceCollectionId,
  currentUserPersonalCollections,
  getCollectionIcon,
  isExamplesCollection,
  isLibraryCollection,
  isRootTrashCollection,
  nonPersonalOrArchivedCollection,
} from "metabase/common/collections/utils";
import { CollapseSection } from "metabase/common/components/CollapseSection";
import { Tree } from "metabase/common/components/tree";
import { useIsAtHomepageDashboard } from "metabase/common/hooks/use-is-at-homepage-dashboard";
import {
  getIsTenantUser,
  getUser,
  getUserCanWriteToCollections,
  getUserIsAdmin,
} from "metabase/current-user";
import {
  useMetabotAgent,
  useUserMetabotPermissions,
} from "metabase/metabot/hooks";
import NewItemButton from "metabase/nav/components/NewItemButton";
import BookmarkList from "metabase/nav/containers/MainNavbar/MainNavbarContainer/BookmarkList";
import { SidebarCollectionLink } from "metabase/nav/containers/MainNavbar/SidebarItems";
import { useDispatch, useSelector } from "metabase/redux";
import { addUndo } from "metabase/redux/undo";
import { useLocation, useNavigate, useParams } from "metabase/router";
import { useSetting, useUserSetting } from "metabase/settings";
import {
  ActionIcon,
  Flex,
  Icon,
  Tooltip,
  UnstyledButton,
  useColorScheme,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import type { Collection } from "metabase-types/api";

import {
  NavRoot,
  PaddedSidebarLink,
  Sidebar,
  SidebarHeading,
  SidebarSection,
} from "../MainNavbar/MainNavbar.styled";
import { isCollectionPath } from "../MainNavbar/getSelectedItems";

// Power BI-style navigation rail (see docs/POWERBI_EXPERIENCE_REDESIGN plan).
// Shown instead of the classic sidebar when the user's
// `navigation-experience` setting is "pbi".

const BROWSE_URL = "/search";
const DATA_URL = "/browse/databases";
const METRICS_URL = "/browse/metrics";
const ADMIN_URL = "/admin";

type NavModal = "MODAL_NEW_COLLECTION" | null;

export function PbiRail({ isOpen }: { isOpen: boolean }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const params = useParams();

  const kbar = useKBar();

  const currentUser = useSelector(getUser);
  const isAdmin = useSelector(getUserIsAdmin);
  const canWriteToCollections = useSelector(getUserCanWriteToCollections);
  const isTenantUser = useSelector(getIsTenantUser);

  const isAtHomepageDashboard = useIsAtHomepageDashboard();

  const { hasMetabotAccess } = useUserMetabotPermissions();
  const metabot = useMetabotAgent("omnibot");
  const metabotName = useSetting("metabot-name");

  const { data: bookmarks = [] } = useListBookmarksQuery();
  const [reorderBookmarksMutation] = useReorderBookmarksMutation();

  const { data: rootCollection } = useGetCollectionQuery({
    id: ROOT_COLLECTION.id,
  });

  const { data: trashCollection } = useGetCollectionQuery(
    { id: "trash" },
    { skip: !canWriteToCollections },
  );

  const { data: collections = [] } = useListCollectionsTreeQuery({
    "exclude-other-user-collections": true,
    "exclude-archived": true,
    "include-library": true,
  });

  const [expandWorkspaces, setExpandWorkspaces] = useUserSetting(
    "expand-collections-in-nav",
  );
  const [expandBookmarks, setExpandBookmarks] = useUserSetting(
    "expand-bookmarks-in-nav",
  );

  const [modal, setModal] = useState<NavModal>(null);

  const workspaces = useMemo<CollectionTreeItem[]>(() => {
    if (!currentUser) {
      return [];
    }

    const personalCollections = currentUserPersonalCollections(
      collections,
      currentUser.id,
    );
    const displayableCollections = collections.filter(
      (collection) =>
        nonPersonalOrArchivedCollection(collection) &&
        !isRootTrashCollection(collection) &&
        !isExamplesCollection(collection) &&
        !isLibraryCollection(collection),
    );

    const tree = buildCollectionTree(
      [...personalCollections, ...displayableCollections],
      { isTenantUser },
    );

    if (trashCollection) {
      const trash: CollectionTreeItem = {
        ...trashCollection,
        id: "trash",
        icon: getCollectionIcon(trashCollection, { isTenantUser }),
        children: [],
      };
      tree.push(trash);
    }

    if (rootCollection) {
      const root: CollectionTreeItem = {
        ...rootCollection,
        icon: getCollectionIcon(rootCollection, { isTenantUser }),
        children: [],
      };
      return [root, ...tree];
    }

    return tree;
  }, [collections, currentUser, rootCollection, trashCollection, isTenantUser]);

  const reorderBookmarks = useCallback(
    async ({ newIndex, oldIndex }: { newIndex: number; oldIndex: number }) => {
      const newBookmarks = [...bookmarks];
      const movedBookmark = newBookmarks[oldIndex];

      newBookmarks.splice(oldIndex, 1);
      newBookmarks.splice(newIndex, 0, movedBookmark);

      const orderings = newBookmarks.map(({ type, item_id }) => ({
        type,
        item_id,
      }));

      try {
        await reorderBookmarksMutation({ orderings }).unwrap();
      } catch {
        dispatch(
          addUndo({
            icon: "warning",
            toastColor: "feedback-negative",
            message: t`Something went wrong`,
          }),
        );
      }
    },
    [bookmarks, reorderBookmarksMutation, dispatch],
  );

  const isSelectedUrl = useCallback(
    (url: string) => pathname === url || pathname.startsWith(`${url}/`),
    [pathname],
  );

  const handleOpenOmnibox = useCallback(() => {
    kbar.query.toggle();
  }, [kbar]);

  // The tree highlights the workspace the user is currently browsing.
  // Collection slugs in URLs are either numeric ids or the "root" alias.
  const selectedWorkspaceId = useMemo(() => {
    return isCollectionPath(pathname)
      ? coerceCollectionId(params.slug)
      : undefined;
  }, [pathname, params.slug]);

  const handleHomeClick = useCallback(
    (event: MouseEvent) => {
      // Prevent navigating to the homepage dashboard when already there
      if (isAtHomepageDashboard) {
        event.preventDefault();
      }
    },
    [isAtHomepageDashboard],
  );

  const handleMetabotClick = useCallback(() => {
    metabot.setVisible(!metabot.visible);
  }, [metabot]);

  const { resolvedColorScheme, toggleColorScheme } = useColorScheme();

  const handleSelectNavItem = useCallback(() => {}, []);

  const onCreateNewCollection = useCallback(() => {
    setModal("MODAL_NEW_COLLECTION");
  }, []);

  const closeModal = useCallback(() => setModal(null), []);

  const handleCreateCollection = useCallback(
    (collection: Collection) => {
      closeModal();
      navigate(Urls.collection(collection));
    },
    [closeModal, navigate],
  );

  return (
    <Sidebar isOpen={isOpen} side="left" data-testid="pbi-rail">
      <NavRoot isOpen={isOpen} aria-label={t`Main navigation`}>
        <div>
          <SidebarSection>
            <NewItemButton />
          </SidebarSection>

          <SidebarSection>
            <ErrorBoundary>
              <UnstyledButton
                onClick={handleOpenOmnibox}
                aria-label={t`Search`}
                data-testid="pbi-omnibox-trigger"
                display="block"
                w="100%"
              >
                <Flex
                  align="center"
                  gap="sm"
                  p="var(--mantine-spacing-md)"
                  c="inherit"
                >
                  <Icon name="search" size={16} />
                  <span>{t`Search`}</span>
                </Flex>
              </UnstyledButton>
              <PaddedSidebarLink
                icon="home"
                url="/"
                isSelected={isAtHomepageDashboard || isSelectedUrl("/")}
                onClick={handleHomeClick}
              >
                {t`Home`}
              </PaddedSidebarLink>

              <SidebarHeading px="var(--mantine-spacing-md)" mt="sm" mb={4}>
                {t`Supply Chain Ops`}
              </SidebarHeading>
              <PaddedSidebarLink
                icon="dashboard"
                url="/dashboard/23"
                isSelected={isSelectedUrl("/dashboard/23") || isSelectedUrl("/operations/overview")}
              >
                {t`Control Tower`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="location"
                url="/operations/orders"
                isSelected={isSelectedUrl("/operations/orders")}
              >
                {t`Order Fulfillment`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="warning"
                url="/operations/exceptions"
                isSelected={isSelectedUrl("/operations/exceptions")}
              >
                {t`Exceptions Triage`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="folder"
                url="/operations/inventory"
                isSelected={isSelectedUrl("/operations/inventory")}
              >
                {t`Network Inventory`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="play"
                url="/operations/scenarios"
                isSelected={isSelectedUrl("/operations/scenarios")}
              >
                {t`Scenario Lab`}
              </PaddedSidebarLink>

              <SidebarHeading px="var(--mantine-spacing-md)" mt="md" mb={4}>
                {t`BI & Analytics`}
              </SidebarHeading>
              <PaddedSidebarLink
                icon="bar"
                url="/collection/root"
                isSelected={isSelectedUrl("/collection/root") || isSelectedUrl("/operations/analytics")}
              >
                {t`Analytics`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="search"
                url={BROWSE_URL}
                isSelected={isSelectedUrl(BROWSE_URL)}
              >
                {t`Browse`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="database"
                url={DATA_URL}
                isSelected={isSelectedUrl(DATA_URL)}
              >
                {t`Data`}
              </PaddedSidebarLink>
              <PaddedSidebarLink
                icon="metric"
                url={METRICS_URL}
                isSelected={isSelectedUrl(METRICS_URL)}
              >
                {t`Metrics`}
              </PaddedSidebarLink>

              {hasMetabotAccess && (
                <>
                  <SidebarHeading px="var(--mantine-spacing-md)" mt="md" mb={4}>
                    {t`AI Copilot`}
                  </SidebarHeading>
                  <PaddedSidebarLink
                    icon="insight"
                    isSelected={metabot.visible}
                    onClick={handleMetabotClick}
                  >
                    {t`Chat with ${metabotName}`}
                  </PaddedSidebarLink>
                </>
              )}
            </ErrorBoundary>
          </SidebarSection>

          {workspaces.length > 0 && (
            <SidebarSection>
              <ErrorBoundary>
                <CollapseSection
                  header={
                    <SidebarHeading
                      onClick={() => navigate("/workspaces")}
                      style={{ cursor: "pointer" }}
                    >
                      {t`Workspaces`}
                    </SidebarHeading>
                  }
                  initialState={expandWorkspaces ? "expanded" : "collapsed"}
                  iconPosition="right"
                  iconSize={8}
                  onToggle={setExpandWorkspaces}
                  rightAction={
                    canWriteToCollections && !isTenantUser ? (
                      <Tooltip label={t`Create a new collection`}>
                        <ActionIcon
                          aria-label={t`Create a new collection`}
                          color="text-secondary"
                          onClick={onCreateNewCollection}
                        >
                          <Icon name="add" />
                        </ActionIcon>
                      </Tooltip>
                    ) : null
                  }
                  role="section"
                  aria-label={t`Workspaces`}
                >
                  <Tree
                    data={workspaces}
                    selectedId={selectedWorkspaceId}
                    onSelect={handleSelectNavItem}
                    TreeNode={SidebarCollectionLink}
                  />
                </CollapseSection>
              </ErrorBoundary>
            </SidebarSection>
          )}

          {bookmarks.length > 0 && (
            <SidebarSection>
              <ErrorBoundary>
                <BookmarkList
                  bookmarks={bookmarks}
                  selectedItem={undefined}
                  onSelect={handleSelectNavItem}
                  reorderBookmarks={reorderBookmarks}
                  onToggle={setExpandBookmarks}
                  initialState={expandBookmarks ? "expanded" : "collapsed"}
                />
              </ErrorBoundary>
            </SidebarSection>
          )}
        </div>

        <div>
          {isAdmin && (
            <SidebarSection>
              <PaddedSidebarLink
                icon="gear"
                url={ADMIN_URL}
                isSelected={isSelectedUrl(ADMIN_URL)}
              >
                {t`Admin settings`}
              </PaddedSidebarLink>
            </SidebarSection>
          )}
          <SidebarSection>
            <PaddedSidebarLink
              icon="person"
              url={Urls.accountSettings()}
              isSelected={isSelectedUrl("/account")}
            >
              {t`Account settings`}
            </PaddedSidebarLink>
            <Tooltip
              label={
                resolvedColorScheme === "dark"
                  ? t`Switch to light theme`
                  : t`Switch to dark theme`
              }
            >
              <UnstyledButton
                onClick={toggleColorScheme}
                aria-label={
                  resolvedColorScheme === "dark"
                    ? t`Switch to light theme`
                    : t`Switch to dark theme`
                }
                w="100%"
              >
                <Flex
                  align="center"
                  gap="sm"
                  p="var(--mantine-spacing-md)"
                  c="inherit"
                >
                  <Icon
                    name={resolvedColorScheme === "dark" ? "sun" : "moon"}
                    size={16}
                  />
                  <span>
                    {resolvedColorScheme === "dark"
                      ? t`Light theme`
                      : t`Dark theme`}
                  </span>
                </Flex>
              </UnstyledButton>
            </Tooltip>
          </SidebarSection>
        </div>

        {modal === "MODAL_NEW_COLLECTION" && (
          <CreateCollectionModal
            onClose={closeModal}
            onCreate={handleCreateCollection}
          />
        )}
      </NavRoot>
    </Sidebar>
  );
}
