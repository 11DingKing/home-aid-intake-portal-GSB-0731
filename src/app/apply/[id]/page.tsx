import { getApplication } from "@/server/applicationService";
import ApplyWizard from "./ApplyWizard";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Server component: load the current server truth, then hand it to the client
// wizard which layers the offline draft cache on top and reconciles.
export default async function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial;
  try {
    initial = await getApplication(id);
  } catch {
    return (
      <section aria-labelledby="notfound-heading">
        <h1 id="notfound-heading">Application not found</h1>
        <div className="banner" data-tone="error" role="alert">
          <span className="banner-title">Not found: </span>
          We could not find application <strong>{id}</strong>.
        </div>
        <p>
          <Link href="/">Return to start</Link>
        </p>
      </section>
    );
  }

  return <ApplyWizard initial={initial} />;
}
