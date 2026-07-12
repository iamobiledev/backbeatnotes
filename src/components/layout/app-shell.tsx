"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookLock,
  BookOpen,
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

type AppShellProps = {
  user: { name: string; email: string };
  platformRole: "admin" | "developer";
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  tree: DocumentTreeNode[];
  favorites: Array<{ id: string; title: string }>;
  children: React.ReactNode;
};

export function AppShell({
  user,
  platformRole,
  workspace,
  workspaces,
  tree,
  favorites,
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [creating, startCreating] = useTransition();

  const canEditDocs = workspace.role !== "guest";

  const createPage = useCallback(
    (parentId?: string, docType: "doc" | "wiki" = "doc") => {
      if (!canEditDocs || creating) return;
      startCreating(async () => {
        try {
          const formData = new FormData();
          formData.set("workspaceId", workspace.id);
          if (parentId) formData.set("parentId", parentId);
          formData.set("title", "Untitled");
          formData.set("docType", docType);
          const doc = await actionCreateDocument(formData);
          router.push(`/app/${workspace.id}/docs/${doc.id}`);
        } catch {
          toast.error("Couldn't create the page. Please try again.");
        }
      });
    },
    [canEditDocs, creating, router, workspace.id],
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
        createPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createPage]);

  const isHome = pathname === `/app/${workspace.id}`;

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
                    href={`/app/${workspace.id}/docs/${fav.id}`}
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

        <div className="group/section">
          <div className="mb-0.5 flex items-center justify-between px-2 py-1">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">
              {workspace.isPersonal ? "Private" : "Pages"}
            </p>
            {canEditDocs && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add a page"
                    disabled={creating}
                    className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--sidebar-hover)] focus-visible:opacity-100 focus-visible:outline-none group-hover/section:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onSelect={() => createPage(undefined, "doc")}>
                    <Plus className="h-4 w-4" />
                    New page
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => createPage(undefined, "wiki")}>
                    <BookOpen className="h-4 w-4" />
                    New wiki
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {tree.length === 0 ? (
            <p className="px-2 py-1 text-[var(--muted-foreground)]">
              No pages yet.
              {canEditDocs && " Press N to start writing."}
            </p>
          ) : (
            <DocumentTree
              nodes={tree}
              workspaceId={workspace.id}
              activePath={pathname ?? ""}
              onCreateChild={canEditDocs ? createPage : undefined}
            />
          )}
          {canEditDocs && (
            <button
              type="button"
              onClick={() => createPage()}
              disabled={creating}
              className="mt-px flex w-full items-center gap-1.5 rounded-md px-2 py-1 font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              New page
            </button>
          )}
        </div>
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
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {shared.length === 0 && (
            <p className="px-2 pb-1.5 text-xs text-[var(--muted-foreground)]">
              No shared workspaces yet.
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
                  New workspace
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
