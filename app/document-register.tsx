"use client";

import { Copy, Download, FileSpreadsheet, FileText, Filter, Plus, Search } from "lucide-react";
import { useState } from "react";

type Template = {
  workflow?: {status:string};
  id: string;
  name: string;
  code: string;
  version: number;
  category: string;
  description: string;
  changeDescription: string;
  revisionDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sourceImportId: string;
  sourceFileName: string;
  documentMeta: {
    documentType: string;
    versionLabel: string;
    classification: string;
    documentOwner: string;
    documentStatus: string;
  };
};

const formatDate = (value: string) => {
  if (!value) return "Pending";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export function DocumentRegister({ templates, onBuild, onRevise }: { templates: Template[]; onBuild: () => void; onRevise: (template: Template) => void }) {
  const statuses = ["All", "Draft", "Submitted for Review", "Changes Requested", "Recommended for Approval", "Submitted for Approval", "Approved", "Superseded", "Archived", "Unassigned legacy"];
  return <DocumentRegisterView templates={templates} onBuild={onBuild} onRevise={onRevise} statuses={statuses} />;
}

function DocumentRegisterView({ templates, onBuild, onRevise, statuses }: { templates: Template[]; onBuild: () => void; onRevise: (template: Template) => void; statuses: string[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const rows = templates.filter((template) => {
    const matchesStatus = status === "All" || (template.workflow?.status || "Unassigned legacy") === status;
    const haystack = `${template.code} ${template.name} ${template.documentMeta.documentType} ${template.documentMeta.documentOwner} ${template.createdBy} ${template.changeDescription}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });

  const exportCsv = () => {
    const data = [
      ["Document ID", "Title", "Type", "Version", "Classification", "Status", "Owner", "Revision date", "Prepared by", "Change description"],
      ...rows.map((template) => [template.code, template.name, template.documentMeta.documentType, template.documentMeta.versionLabel || template.version, template.documentMeta.classification, (template.workflow?.status || "Unassigned legacy"), template.documentMeta.documentOwner, template.revisionDate, template.createdBy, template.changeDescription]),
    ];
    const csv = data.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "CCPL-controlled-document-register.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="content register-page document-register-page">
    <div className="page-heading"><div><p className="eyebrow">Controlled document register</p><h1>Document register</h1><p>Every saved version remains listed with its change description, owner, status, and controlled outputs.</p></div><div className="heading-actions"><button className="button secondary" onClick={exportCsv}><FileSpreadsheet size={16} />Export CSV</button><button className="button primary" onClick={onBuild}><Plus size={17} />New document</button></div></div>
    <section className="register-switcher document-register-summary"><div className="document-glyph glyph-1"><FileSpreadsheet size={22} /><span>DOCS</span></div><div><span>Controlled versions</span><strong>{templates.length}</strong><small>Earlier versions are never replaced.</small></div><div className="register-stat"><span>Approved</span><strong>{templates.filter((template) => (template.workflow?.status || "Unassigned legacy") === "Approved").length}</strong></div><div className="register-stat"><span>Draft</span><strong>{templates.filter((template) => (template.workflow?.status || "Unassigned legacy").includes("Draft")).length}</strong></div></section>
    <div className="register-toolbar"><label className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, title, owner, author, or change description" /></label><label className="filter-select"><Filter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    {rows.length ? <div className="table-card register-table document-version-table"><table><thead><tr><th>Document</th><th>Type</th><th>Version</th><th>Revision date</th><th>Owner</th><th>Status</th><th>Outputs</th><th /></tr></thead><tbody>{rows.map((template) => <tr key={template.id}><td><strong className="reference">{template.code}</strong><small>{template.name}</small><small>{template.changeDescription || "Initial issue"}</small></td><td>{template.documentMeta.documentType}</td><td>v{template.documentMeta.versionLabel || template.version}</td><td>{formatDate(template.revisionDate || template.updatedAt)}</td><td>{template.documentMeta.documentOwner}<small>{template.createdBy}</small></td><td><span className={`status status-${(template.workflow?.status || "Unassigned legacy").toLowerCase().replaceAll(" ", "-")}`}><span />{(template.workflow?.status || "Unassigned legacy")}</span></td><td><div className="output-links"><a className="button secondary small" href={`/api/document/pdf?id=${template.id}`}><Download size={14} />PDF</a><a className="button secondary small" href={`/api/document/docx?id=${template.id}`}><FileText size={14} />Word</a>{template.sourceImportId && <a className="button secondary small" href={`/api/document/import?id=${template.sourceImportId}`}><Download size={14} />Original</a>}</div></td><td><button className="icon-button" onClick={() => onRevise(template)} title="Create next version"><Copy size={15} /></button></td></tr>)}</tbody></table></div> : <div className="empty-state register-empty"><Search size={29} /><div><strong>No matching documents</strong><p>Adjust the search or status filter, or create the first controlled document.</p></div></div>}
  </div>;
}
