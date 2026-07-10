import { useParams } from "react-router";
import { UserNoteReader } from "@/components/mentor/user-note-reader";

export const handle = { titleKey: "MyNotes.title" };

export function Component() {
  const { id = "" } = useParams<{ id: string }>();
  return (
    <div className="mx-auto w-full max-w-4xl">
      <UserNoteReader id={id} />
    </div>
  );
}
