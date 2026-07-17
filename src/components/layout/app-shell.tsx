"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookLock,
  BookOpen,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Home,
  Menu,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings,
  SquarePen,
  Star,
  Sun,
  Trash2,
  LogOut,
  Keyboard,
  UserPlus,
} from "lucide-react";
import { brand } from "@/config/brand";
import { BrandLogo, BrandMark } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { signOut } from "@/lib/auth-client";
import { useTheme, type ThemePreference } from "@/components/theme/theme";
import {
  actionListWorkspaceTree,
  actionMoveDocument,
} from "@/app/actions";
import { createDocumentAndNavigate } from "@/components/documents/create-document";
import type { DocumentTreeNode, WorkspaceSummary } from "@/lib/documents/types";
import { DROP_TARGET_CLASS, useRootDropTarget } from "./tree-dnd";

const CommandPalette = dynamic(() =>
  import("@/components/search/command-palette").then(
    (module) => module.CommandPalette,
  ),
);
const ShortcutsDialog = dynamic(() =>
  import("./shortcuts-dialog").then((module) => module.ShortcutsDialog),
);
// Keep the shell's initial hydrate light: tree menus/DnD load after first paint
// so clicks on workspace/Recent cards are not blocked by long input delay.
const DocumentTree = dynamic(
  () => import("./document-tree").then((module) => module.DocumentTree),
  {
    loading: () => (
      <p className="px-2 py-1 text-[var(--muted-foreground)]">Loading pages…</p>
    ),
  },
);

type WorkspaceTree = {
  workspaceId: string;
  nodes: DocumentTreeNode[];
};

type AppShellProps = {
  user: { name: string; email: string };
  platformRole: "admin" | "developer";
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  /** Sidebar trees for every workspace (Private + Teamspaces sections). */
  trees: WorkspaceTree[];
  favorites: Array<{ id: string; title: string; workspaceId: string }>;
  /** Every favorited document id for the user (for tree row menus). */
  favoriteIds: string[];
  /** Pages shared directly with the user (Notion-style "Shared" section). */
  shared: Array<{
    id: string;
    title: string;
    icon: string | null;
    workspaceId: string;
  }>;
  children: React.ReactNode;
};

export function AppShell({
  user,
  platformRole,
  workspace,
  workspaces,
  trees,
  favorites,
  favoriteIds,
  shared,
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [creating, startCreating] = useTransition();

  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const treeByWorkspace = useMemo(
    () => new Map(trees.map((tree) => [tree.workspaceId, tree.nodes])),
    [trees],
  );
  const canEditDocs = workspace.role !== "guest";

  const createPage = useCallback(
    (
      parentId?: string,
      docType: "doc" | "wiki" = "doc",
      targetWorkspaceId: string = workspace.id,
    ) => {
      if (creating) return;
      startCreating(() =>
        createDocumentAndNavigate(router, {
          workspaceId: targetWorkspaceId,
          parentId,
          docType,
        }),
      );
    },
    [creating, router, workspace.id],
  );

  // Lightweight global shortcuts mount heavy dialogs only on first use.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === "Escape" && drawerOpen) {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
      if (
        (event.key === "n" || event.key === "N") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        if (canEditDocs) createPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPage, canEditDocs, drawerOpen]);

  const isHome = pathname === `/app/${workspace.id}`;

  const personal = workspaces.find((w) => w.isPersonal);
  const personalTree = personal ? treeByWorkspace.get(personal.id) ?? [] : [];
  const teamspaces = workspaces.filter((w) => !w.isPersonal);

  const sidebar = (
    <div className="flex h-full flex-col text-sm">
      <div className="flex items-center gap-1 px-2">
        <Link
          href={`/app/${workspace.id}`}
          aria-label={`${brand.name} workspace home`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <BrandMark className="h-6 w-6" />
        </Link>
        <WorkspaceSwitcher
          current={workspace}
          workspaces={workspaces}
          canCreateWorkspace={platformRole === "admin"}
        />
        {canEditDocs && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New page"
                disabled={creating}
                onClick={() => createPage()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <SquarePen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>New page (N)</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="mt-1 space-y-px px-2">
        <SidebarItem
          icon={<Search className="h-4 w-4" />}
          label="Search"
          trailing={
            <kbd className="text-[11px] text-[var(--muted-foreground)]">⌘K</kbd>
          }
          onClick={() => setSearchOpen(true)}
        />
        <SidebarItem
          icon={<Home className="h-4 w-4" />}
          label="Home"
          href={`/app/${workspace.id}`}
          active={isHome}
        />
        <SidebarItem
          icon={<Settings className="h-4 w-4" />}
          label="Settings"
          href={`/app/${workspace.id}/settings`}
          active={pathname?.endsWith("/settings")}
        />
      </div>

      <nav
        aria-label="Documents"
        className="mt-4 flex-1 space-y-4 overflow-y-auto px-2 pb-4"
      >
        {favorites.length > 0 && (
          <div>
            <p className="mb-0.5 px-2 py-1 text-xs font-medium text-[var(--muted-foreground)]">
              Favorites
            </p>
            <ul className="space-y-px">
              {favorites.map((fav) => (
                <li key={fav.id}>
                  <Link
                    href={`/app/${fav.workspaceId}/docs/${fav.id}`}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:bg-[var(--sidebar-hover)] ${
                      pathname?.endsWith(`/docs/${fav.id}`)
                        ? "bg-[var(--sidebar-active)] text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    <Star className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{fav.title || "Untitled"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {shared.length > 0 && (
          <div>
            <p className="mb-0.5 px-2 py-1 text-xs font-medium text-[var(--muted-foreground)]">
              Shared
            </p>
            <ul className="space-y-px">
              {shared.map((docItem) => (
                <li key={docItem.id}>
                  <Link
                    href={`/app/${docItem.workspaceId}/docs/${docItem.id}`}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:bg-[var(--sidebar-hover)] ${
                      pathname?.endsWith(`/docs/${docItem.id}`)
                        ? "bg-[var(--sidebar-active)] text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]"
                    }`}
                  >
                    {docItem.icon ? (
                      <span className="w-3.5 shrink-0 text-center text-sm leading-none">
                        {docItem.icon}
                      </span>
                    ) : (
                      <UserPlus className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {docItem.title || "Untitled"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {personal && (
          <SidebarSection
            label="Private"
            canAdd
            adding={creating}
            onAddPage={() => createPage(undefined, "doc", personal.id)}
            onAddWiki={() => createPage(undefined, "wiki", personal.id)}
            dropWorkspaceId={personal.id}
            canDrop={personal.role !== "guest"}
            onMoved={() => router.refresh()}
          >
            {personalTree.length === 0 ? (
              <p className="px-2 py-1 text-[var(--muted-foreground)]">
                No private pages yet.
              </p>
            ) : (
              <DocumentTree
                nodes={personalTree}
                workspaceId={personal.id}
                activePath={pathname ?? ""}
                favoriteIds={favoriteIdSet}
                canEdit={personal.role !== "guest"}
                rootLabel="Private"
                onCreateChild={(parentId) =>
                  createPage(parentId, "doc", personal.id)
                }
                onMoved={() => router.refresh()}
              />
            )}
          </SidebarSection>
        )}

        {teamspaces.length > 0 && (
          <div>
            <p className="mb-0.5 px-2 py-1 text-xs font-medium text-[var(--muted-foreground)]">
              Teamspaces
            </p>
            <ul className="space-y-px">
              {teamspaces.map((ws) => {
                const initialNodes = treeByWorkspace.get(ws.id);
                return (
                  <TeamspaceItem
                    key={ws.id}
                    workspace={ws}
                    initialNodes={initialNodes}
                    isCurrent={ws.id === workspace.id}
                    pathname={pathname ?? ""}
                    favoriteIds={favoriteIdSet}
                    creating={creating}
                    onCreatePage={(parentId, docType) =>
                      createPage(parentId, docType, ws.id)
                    }
                  />
                );
              })}
            </ul>
          </div>
        )}
      </nav>

      <div className="space-y-px px-2 py-2">
        <SidebarItem
          icon={<Trash2 className="h-4 w-4" />}
          label="Trash"
          href={`/app/${workspace.id}/trash`}
          active={pathname?.endsWith("/trash")}
        />
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen w-full">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/35 md:hidden"
            onPointerDown={() => setDrawerOpen(false)}
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* One responsive sidebar: fixed drawer on mobile, sticky on desktop. */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 h-screen w-72 max-w-[85vw] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] py-2 transition-transform duration-150 md:sticky md:top-0 md:z-auto md:w-60 md:max-w-none md:translate-x-0 ${
            drawerOpen
              ? "visible translate-x-0"
              : "invisible -translate-x-full md:visible"
          }`}
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("a")) setDrawerOpen(false);
          }}
        >
          {sidebar}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-11 items-center gap-2 bg-[color-mix(in_oklab,var(--background)_88%,transparent)] px-3 backdrop-blur md:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </Button>

            <Link
              href={`/app/${workspace.id}`}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium transition-colors hover:bg-[var(--sidebar-hover)]"
            >
              {workspace.isPersonal && (
                <BookLock className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              )}
              <span className="truncate">{workspace.name}</span>
            </Link>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden"
                aria-label="Search"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <Avatar name={user.name} className="h-7 w-7 text-xs" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="normal-case tracking-normal">
                    <span className="block text-sm font-medium text-[var(--foreground)]">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs font-normal">
                      {user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
                    <Keyboard className="h-4 w-4" />
                    Keyboard shortcuts
                    <kbd className="ml-auto text-xs text-[var(--muted-foreground)]">
                      ?
                    </kbd>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <AppearancePicker />
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={async () => {
                      await signOut();
                      router.push("/sign-in");
                      router.refresh();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 px-4 py-4 md:px-8">{children}</main>
        </div>
      </div>

      {searchOpen && (
        <CommandPalette
          workspaceId={workspace.id}
          open
          onOpenChange={setSearchOpen}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog open onOpenChange={setShortcutsOpen} />
      )}
    </TooltipProvider>
  );
}

const APPEARANCE_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  {
    value: "system",
    label: "Sync with system",
    icon: <Monitor className="h-4 w-4" />,
  },
];

/** Light / Dark / System selector shown in the account (profile) menu. */
function AppearancePicker() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      {APPEARANCE_OPTIONS.map((option) => (
        <DropdownMenuItem
          key={option.value}
          onSelect={(event) => {
            // Keep the menu open so the change is visible immediately.
            event.preventDefault();
            setTheme(option.value);
          }}
        >
          {option.icon}
          {option.label}
          {theme === option.value && (
            <Check className="ml-auto h-3.5 w-3.5 text-[var(--primary)]" />
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * Root drop zone behavior: dropping a dragged page on a section header (or
 * teamspace row) moves it back to the top level of that workspace.
 */
function useMoveToRoot({
  workspaceId,
  enabled,
  onMoved,
}: {
  workspaceId: string;
  enabled: boolean;
  onMoved: () => void;
}) {
  const [, startMove] = useTransition();
  return useRootDropTarget({
    workspaceId,
    enabled,
    onDropDocument: (documentId) => {
      startMove(async () => {
        const result = await actionMoveDocument({
          documentId,
          newParentId: null,
        });
        if (result.ok) {
          toast.success("Moved to top level");
          onMoved();
        } else {
          toast.error(result.error);
        }
      });
    },
  });
}

/** Section header with a hover-reveal "+" (new page / new wiki) menu. */
function SidebarSection({
  label,
  canAdd,
  adding,
  onAddPage,
  onAddWiki,
  dropWorkspaceId,
  canDrop = false,
  onMoved,
  children,
}: {
  label: string;
  canAdd: boolean;
  adding?: boolean;
  onAddPage: () => void;
  onAddWiki: () => void;
  /** When set, the header accepts page drops (move to top level). */
  dropWorkspaceId?: string;
  canDrop?: boolean;
  onMoved?: () => void;
  children: React.ReactNode;
}) {
  const { isDropTarget, dropProps } = useMoveToRoot({
    workspaceId: dropWorkspaceId ?? "",
    enabled: Boolean(dropWorkspaceId) && canDrop,
    onMoved: onMoved ?? (() => {}),
  });
  return (
    <div className="group/section">
      <div
        {...dropProps}
        className={`mb-0.5 flex items-center justify-between rounded-md px-2 py-1 ${
          isDropTarget ? DROP_TARGET_CLASS : ""
        }`}
      >
        <p className="text-xs font-medium text-[var(--muted-foreground)]">
          {label}
        </p>
        {canAdd && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Add a page to ${label}`}
                disabled={adding}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--sidebar-hover)] focus-visible:opacity-100 focus-visible:outline-none group-hover/section:opacity-100 data-[state=open]:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onSelect={onAddPage}>
                <Plus className="h-4 w-4" />
                New page
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddWiki}>
                <BookOpen className="h-4 w-4" />
                New wiki
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {children}
    </div>
  );
}

/** A Notion-style teamspace: avatar row that expands into its page tree. */
function TeamspaceItem({
  workspace,
  initialNodes,
  isCurrent,
  pathname,
  favoriteIds,
  creating,
  onCreatePage,
}: {
  workspace: WorkspaceSummary;
  initialNodes?: DocumentTreeNode[];
  isCurrent: boolean;
  pathname: string;
  favoriteIds: Set<string>;
  creating: boolean;
  onCreatePage: (parentId?: string, docType?: "doc" | "wiki") => void;
}) {
  const router = useRouter();
  // The active teamspace starts expanded; the rest start collapsed.
  const [expanded, setExpanded] = useState(isCurrent);
  const [loadedNodes, setLoadedNodes] = useState<
    DocumentTreeNode[] | undefined
  >();
  const [loadingTree, startTreeLoad] = useTransition();
  const nodes = initialNodes ?? loadedNodes;
  const canEdit = workspace.role !== "guest";

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || nodes !== undefined || loadingTree) return;
    startTreeLoad(async () => {
      const result = await actionListWorkspaceTree({
        workspaceId: workspace.id,
      });
      if (result.ok) setLoadedNodes(result.data);
      else toast.error(result.error);
    });
  };

  // After a page moved: lazily-loaded trees must be refetched by hand —
  // router.refresh() only updates the server-rendered (preloaded) trees.
  const handleMoved = useCallback(() => {
    if (initialNodes === undefined) {
      startTreeLoad(async () => {
        const result = await actionListWorkspaceTree({
          workspaceId: workspace.id,
        });
        if (result.ok) setLoadedNodes(result.data);
      });
    }
    router.refresh();
  }, [initialNodes, router, workspace.id]);

  // Dropping a page on the teamspace row moves it to the top level.
  const { isDropTarget, dropProps } = useMoveToRoot({
    workspaceId: workspace.id,
    enabled: canEdit,
    onMoved: () => {
      setExpanded(true);
      handleMoved();
    },
  });

  return (
    <li>
      <div
        {...dropProps}
        className={`group/ts flex items-center rounded-md pr-1 transition-colors hover:bg-[var(--sidebar-hover)] ${
          isCurrent && pathname === `/app/${workspace.id}`
            ? "bg-[var(--sidebar-active)]"
            : ""
        } ${isDropTarget ? DROP_TARGET_CLASS : ""}`}
      >
        {/* Avatar swaps to a chevron on hover, like Notion. */}
        <button
          type="button"
          aria-label={expanded ? "Collapse teamspace" : "Expand teamspace"}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center focus-visible:outline-none"
        >
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover/ts:opacity-0">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--sidebar-active)] text-[11px] font-semibold text-[var(--foreground)]">
              {workspace.name[0]?.toUpperCase() ?? "T"}
            </span>
          </span>
          <span className="absolute inset-0.5 flex items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--hover-strong)] group-hover/ts:opacity-100">
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
          </span>
        </button>
        <Link
          href={`/app/${workspace.id}`}
          className={`min-w-0 flex-1 truncate py-1 pl-1 text-sm font-medium ${
            isCurrent ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
          }`}
        >
          {workspace.name}
        </Link>
        {canEdit && (
          <button
            type="button"
            aria-label={`Add a page to ${workspace.name}`}
            title="Add a page"
            disabled={creating}
            onClick={() => {
              setExpanded(true);
              onCreatePage();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--hover-strong)] focus-visible:opacity-100 focus-visible:outline-none group-hover/ts:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="pl-3">
          {loadingTree && nodes === undefined ? (
            <p className="px-2 py-1 text-[var(--muted-foreground)]">
              Loading pages…
            </p>
          ) : (nodes?.length ?? 0) === 0 ? (
            <p className="px-2 py-1 text-[var(--muted-foreground)]">
              No pages yet.
            </p>
          ) : (
            <DocumentTree
              nodes={nodes ?? []}
              workspaceId={workspace.id}
              activePath={pathname}
              favoriteIds={favoriteIds}
              canEdit={canEdit}
              rootLabel={workspace.name}
              onCreateChild={
                canEdit ? (parentId) => onCreatePage(parentId) : undefined
              }
              onMoved={handleMoved}
            />
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => onCreatePage()}
              disabled={creating}
              className="mt-px flex w-full items-center gap-1.5 rounded-md px-2 py-1 font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New page
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function SidebarItem({
  icon,
  label,
  href,
  active,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  const className = `flex w-full items-center gap-2 rounded-md px-2 py-1 font-medium transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
    active
      ? "bg-[var(--sidebar-active)] text-[var(--foreground)]"
      : "text-[var(--muted-foreground)]"
  }`;
  const content = (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function WorkspaceSwitcher({
  current,
  workspaces,
  canCreateWorkspace,
}: {
  current: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  canCreateWorkspace: boolean;
}) {
  const personal = workspaces.filter((w) => w.isPersonal);
  const shared = workspaces.filter((w) => !w.isPersonal);

  return (
    <div className="min-w-0 flex-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {current.isPersonal ? (
              <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded bg-[var(--sidebar-active)]">
                <BookLock className="h-3.5 w-3.5 text-[var(--foreground)]" />
              </span>
            ) : (
              <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded bg-[var(--foreground)] text-xs font-semibold text-[var(--background)]">
                {current.name[0]?.toUpperCase() ?? "W"}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {current.name}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {personal.length > 0 && (
            <>
              <DropdownMenuLabel>Private</DropdownMenuLabel>
              {personal.map((ws) => (
                <DropdownMenuItem key={ws.id} asChild>
                  <Link href={`/app/${ws.id}`}>
                    <BookLock className="h-4 w-4" />
                    {ws.name}
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuLabel>Teamspaces</DropdownMenuLabel>
          {shared.length === 0 && (
            <p className="px-2 pb-1.5 text-xs text-[var(--muted-foreground)]">
              No teamspaces yet.
            </p>
          )}
          {shared.map((ws) => (
            <DropdownMenuItem key={ws.id} asChild>
              <Link href={`/app/${ws.id}`}>
                <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--foreground)] text-[10px] font-semibold text-[var(--background)]">
                  {ws.name[0]?.toUpperCase() ?? "W"}
                </span>
                {ws.name}
              </Link>
            </DropdownMenuItem>
          ))}
          {canCreateWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/app/new">
                  <Plus className="h-4 w-4" />
                  New teamspace
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-[var(--muted-foreground)]">
            <BrandLogo
              markClassName="h-4 w-4"
              wordmarkClassName="text-[11px] font-semibold"
            />
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
