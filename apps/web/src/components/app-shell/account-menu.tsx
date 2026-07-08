import { DropdownMenu } from "radix-ui";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { LogOut, User as UserIcon } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useLocale } from "@/hooks/use-locale";

function initialOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}

export function AccountMenu() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();

  async function handleSignOut() {
    await signOut();
    navigate(`/${locale}`, { replace: true });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("TopBar.account")}
          className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initialOf(profile?.display_name, user?.email)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-52 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{profile?.display_name ?? t("TopBar.account")}</p>
            {user?.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => navigate(`/${locale}/profile`)}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent"
          >
            <UserIcon className="size-4" /> {t("Nav.profile")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void handleSignOut()}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-coral outline-none focus:bg-coral/10"
          >
            <LogOut className="size-4" /> {t("TopBar.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
