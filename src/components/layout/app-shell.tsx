"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookLock,
  BookOpen,
  ChevronRight,
  ChevronsUpDown,
  Home,
  Menu,
  Plus,
  Search,
  Settings,
  SquarePen,
  Star,
  Trash2,
  LogOut,
  Keyboard,
} from "lucide-react";
import { brand } from "@/config/brand";
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
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { signOut } from "@/lib/auth-client";
import { actionCreateDocument } from "@/app/actions";
import type { DocumentTreeNode, WorkspaceSummary } from "@/lib/documents/types";
import { DocumentTree } from "./document-tree";
import { CommandPalette } from "@/components/search/command-palette";
import { ShortcutsDialog } from "./shortcuts-dialog";

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
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [creating, startCreating] = useTransition();

  const favoriteIdSet = new Set(favoriteIds);
  const canEditDocs = workspace.role !== "guest";

  const createPage = useCallback(
    (
      parentId?: string,
      docType: "doc" | "wiki" = "doc",
      targetWorkspaceId: string = workspace.id,
    ) => {
      if (creating) return;
      startCreating(async () => {
        try {
          const formData = new FormData();
          formData.set("workspaceId", targetWorkspaceId);
          if (parentId) formData.set("parentId", parentId);
          formData.set("title", "Untitled");
          formData.set("docType", docType);
          const doc = await actionCreateDocument(formData);
          router.push(`/app/${targetWorkspaceId}/docs/${doc.id}`);
        } catch {
          toast.error("Couldn't create the page. Please try again.");
        }
      });
    },
    [creating, router, workspace.id],
  );

  // Global keyboard shortcuts (Cmd+K handled by the palette itself).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [createPage, canEditDocs]);

  const isHome = pathname === `/app/${workspace.id}`;

  const personal = workspaces.find((w) => w.isPersonal);
  const personalTree = personal
    ? trees.find((t) => t.workspaceId === personal.id)?.nodes ?? []
    : [];
  const teamspaces = workspaces.filter((w) => !w.isPersonal);

  const sidebar = (
    <div className="flex h-full flex-col text-sm">
      <div className="flex items-center gap-1 px-2">
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
          onClick={() =>
            window.dispatchEvent(new CustomEvent("docloom:open-search"))
          }
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

        {personal && (
          <SidebarSection
            label="Private"
            canAdd
            adding={creating}
            onAddPage={() => createPage(undefined, "doc", personal.id)}
            onAddWiki={() => createPage(undefined, "wiki", personal.id)}
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
                onCreateChild={(parentId) =>
                  createPage(parentId, "doc", personal.id)
                }
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
              {teamspaces.map((ws) => (
                <TeamspaceItem
                  key={ws.id}
                  workspace={ws}
                  nodes={trees.find((t) => t.workspaceId === ws.id)?.nodes ?? []}
                  isCurrent={ws.id === workspace.id}
                  pathname={pathname ?? ""}
                  favoriteIds={favoriteIdSet}
                  creating={creating}
                  onCreatePage={(parentId, docType) =>
                    createPage(parentId, docType, ws.id)
                  }
                />
              ))}
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
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] py-2 md:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogContent
            hideClose
            className="fixed inset-y-0 left-0 h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 bg-[var(--sidebar)] p-0 py-2 top-0 data-[state=open]:animate-fade md:hidden"
            style={{ left: 0, top: 0, transform: "none" }}
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            {/* Close the drawer when any link inside is followed. */}
            <div
              className="h-full"
              onClickCapture={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("a")) setDrawerOpen(false);
              }}
            >
              {sidebar}
            </div>
          </DialogContent>
        </Dialog>

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
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("docloom:open-search"))
                }
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

      <CommandPalette workspaceId={workspace.id} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </TooltipProvider>
  );
}

/** Section header with a hover-reveal "+" (new page / new wiki) menu. */
function SidebarSection({
  label,
  canAdd,
  adding,
  onAddPage,
  onAddWiki,
  children,
}: {
  label: string;
  canAdd: boolean;
  adding?: boolean;
  onAddPage: () => void;
  onAddWiki: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group/section">
      <div className="mb-0.5 flex items-center justify-between px-2 py-1">
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
  nodes,
  isCurrent,
  pathname,
  favoriteIds,
  creating,
  onCreatePage,
}: {
  workspace: WorkspaceSummary;
  nodes: DocumentTreeNode[];
  isCurrent: boolean;
  pathname: string;
  favoriteIds: Set<string>;
  creating: boolean;
  onCreatePage: (parentId?: string, docType?: "doc" | "wiki") => void;
}) {
  // The active teamspace starts expanded; the rest start collapsed.
  const [expanded, setExpanded] = useState(isCurrent);
  const canEdit = workspace.role !== "guest";

  return (
    <li>
      <div
        className={`group/ts flex items-center rounded-md pr-1 transition-colors hover:bg-[var(--sidebar-hover)] ${
          isCurrent && pathname === `/app/${workspace.id}`
            ? "bg-[var(--sidebar-active)]"
            : ""
        }`}
      >
        {/* Avatar swaps to a chevron on hover, like Notion. */}
        <button
          type="button"
          aria-label={expanded ? "Collapse teamspace" : "Expand teamspace"}
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center focus-visible:outline-none"
        >
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover/ts:opacity-0">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--sidebar-active)] text-[11px] font-semibold text-[var(--foreground)]">
              {workspace.name[0]?.toUpperCase() ?? "T"}
            </span>
          </span>
          <span className="absolute inset-0.5 flex items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[rgba(55,53,47,0.12)] group-hover/ts:opacity-100">
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
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[rgba(55,53,47,0.12)] focus-visible:opacity-100 focus-visible:outline-none group-hover/ts:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="pl-3">
          {nodes.length === 0 ? (
            <p className="px-2 py-1 text-[var(--muted-foreground)]">
              No pages yet.
            </p>
          ) : (
            <DocumentTree
              nodes={nodes}
              workspaceId={workspace.id}
              activePath={pathname}
              favoriteIds={favoriteIds}
              onCreateChild={
                canEdit ? (parentId) => onCreatePage(parentId) : undefined
              }
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
          <p className="px-2 py-1 text-[11px] text-[var(--muted-foreground)]">
            {brand.name}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
