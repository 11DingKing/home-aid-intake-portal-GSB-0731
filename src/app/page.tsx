import Link from "next/link";

export default function HomePage() {
  return (
    <main id="main-content" className="container">
      <div className="page-header">
        <h1>法律援助预申请系统</h1>
        <p>无障碍 · 可离线保存 · 分步填写 · 随时接续</p>
      </div>

      <div className="card">
        <h2>开始新的预申请</h2>
        <p>
          您可以分步填写法援预申请表。系统会自动保存草稿，支持离线填写和合理便利需求记录。
        </p>
        <p>
          行动不便的申请人可选择需要的合理便利安排（上门访问、手语翻译等），这些信息会被安全保存。
        </p>
        <div className="button-row">
          <Link href="/apply/new" className="btn btn-primary" role="button">
            开始申请
          </Link>
          <Link href="/staff" className="btn btn-secondary" role="button">
            工作人员入口
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>无障碍说明</h2>
        <ul>
          <li>所有表单控件均有标签和错误提示，支持屏幕阅读器</li>
          <li>完整的键盘导航支持，错误发生时自动聚焦到问题字段</li>
          <li>状态不仅通过颜色区分，还配有图标和文字说明</li>
          <li>草稿自动保存，网络中断后恢复连接自动同步</li>
          <li>合理便利需求不会被旧草稿覆盖</li>
        </ul>
      </div>
    </main>
  );
}
