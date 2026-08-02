import Link from "next/link";
import StartApplication from "./StartApplication";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <section aria-labelledby="home-heading">
      <h1 id="home-heading">Legal Aid Pre-Application</h1>
      <p>
        Apply for legal aid in short steps. Your progress is saved on this device
        as you go, so you can stop and continue later — even if your connection
        drops. When you are ready, submit for review by our intake staff.
      </p>

      <div className="card">
        <h2>Start a new application</h2>
        <p className="hint">
          We will create an application reference for you. Keep it to resume later
          or to check your status.
        </p>
        <StartApplication />
      </div>

      <div className="card">
        <h2>Resume an application</h2>
        <p className="hint">
          Enter your application reference (for example, <code>APP-201</code>).
        </p>
        <ResumeForm />
      </div>

      <p>
        Are you intake staff? <Link href="/staff">Open the staff queue</Link>.
      </p>
    </section>
  );
}

function ResumeForm() {
  return (
    <form action="/apply/redirect" method="get">
      <div className="field">
        <label htmlFor="resume-id">Application reference</label>
        <input
          id="resume-id"
          name="id"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="APP-201"
          required
        />
      </div>
      <button type="submit">Resume application</button>
    </form>
  );
}
