import { ApplicationForm } from "@/components/ApplicationForm";

interface ApplyPageProps {
  params: { id: string };
}

export default function ApplyPage({ params }: ApplyPageProps) {
  return (
    <main id="main-content" className="container">
      <div className="page-header">
        <h1>法援预申请表</h1>
        <p>请按步骤填写，标有 * 的为必填项。草稿会自动保存。</p>
      </div>
      <ApplicationForm applicationId={params.id} />
    </main>
  );
}
