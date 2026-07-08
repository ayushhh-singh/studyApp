import { useTranslation } from "react-i18next";
import type { CommunityAuthor } from "@prayasup/shared";

/** A post/thread author's public identity — handle first, display_name as fallback, never an email. */
export function CommunityAuthorLine({ author, className }: { author: CommunityAuthor; className?: string }) {
  const { t } = useTranslation();
  const name = author.handle ? `@${author.handle}` : author.display_name || t("Community.anonymous");
  return <span className={className}>{name}</span>;
}
