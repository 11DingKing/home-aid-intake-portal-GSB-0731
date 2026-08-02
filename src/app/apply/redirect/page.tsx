import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Redirect helper for the "resume application" form (GET ?id=APP-xxx).
export default async function ApplyRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const trimmed = (id ?? "").trim();
  if (trimmed.length === 0) redirect("/");
  redirect(`/apply/${encodeURIComponent(trimmed)}`);
}
