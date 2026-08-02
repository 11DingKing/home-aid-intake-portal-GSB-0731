import Link from "next/link";
import { listApplicationsForStaff } from "@/server/applicationService";
import StatusBadge from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

// Staff queue. The list intentionally exposes only non-sensitive fields:
// application id, state, accommodations, and last-updated. No applicant PII.
export default async function StaffQueuePage() {
  const items = await listApplicationsForStaff();
  return (
    <section aria-labelledby="staff-heading">
      <h1 id="staff-heading">Intake queue</h1>
      <p>
        Select an application to continue. Each application opens in a
        disclosure-limited view that shows only the fields your task requires.
      </p>
      {items.length === 0 ? (
        <div className="banner" data-tone="info" role="status">
          <span className="banner-title">Empty: </span>No applications yet.
        </div>
      ) : (
        <table>
          <caption className="sr-only">Applications awaiting staff action</caption>
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Status</th>
              <th scope="col">Accommodations</th>
              <th scope="col">Updated</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <th scope="row">{item.id}</th>
                <td>
                  <StatusBadge state={item.state} />
                </td>
                <td>
                  {item.accommodations.length > 0 ? (
                    item.accommodations.join(", ")
                  ) : (
                    <span>None</span>
                  )}
                </td>
                <td>{new Date(item.updatedAt).toLocaleString()}</td>
                <td>
                  <Link href={`/staff/${item.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
