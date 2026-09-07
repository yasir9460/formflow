"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp,
  AlertTriangle, Bold, Check, Columns3, Copy, FileImage, FileText, FileUp, GripVertical,
  Heading1, Heading2, Heading3, Italic, List, Minus, Plus, Rows3,
  Loader2, Save, SeparatorHorizontal, Space, Table2, Trash2, Underline, UploadCloud,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

export type DocumentBlockType = "heading1" | "heading2" | "heading3" | "paragraph" | "bullets" | "table" | "image" | "divider" | "spacer" | "page-break" | "signature";
export type DocumentBlock = {
  id: string;
  type: DocumentBlockType;
  text?: string;
  items?: string[];
  cells?: string[][];
  headerRow?: boolean;
  imageDataUrl?: string;
  caption?: string;
  align?: "left" | "center" | "right" | "justify";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  spacerHeight?: number;
};

type DocumentMeta = {
  outputStyle: "operational-form" | "controlled-document";
  documentType: string;
  versionLabel: string;
  classification: string;
  documentOwner: string;
  documentStatus: string;
  effectiveDate: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  subtitle: string;
};

export type DocumentBuilderState = {
  editingTemplateId?: string;
  expectedRevision?: number;
  name: string;
  code: string;
  category: string;
  description: string;
  numberingPattern: string;
  baseTemplateId: string;
  sourceImportId: string;
  sourceFileName: string;
  sourceFileHash: string;
  importSummary: Record<string, number>;
  documentMeta: DocumentMeta;
  changeDescription: string;
  revisionDate: string;
};

type ImportResult = {
  source: { importId: string; fileName: string; fileSize: number; sha256: string; importedBy: string; importedAt: string };
  metadata: { title: string; code: string; versionLabel: string; documentType: string; classification: string };
  warnings: string[];
  summary: Record<string, number> & { totalBlocks: number; removedFrontMatterBlocks: number };
  blocks: DocumentBlock[];
};

async function readImportResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (contentType.includes("application/json")) {
    try { return JSON.parse(raw) as ImportResult & { error?: string }; } catch { /* handled below */ }
  }
  if (response.status === 413) throw new Error("The server rejected this file because it is too large. Choose a DOCX smaller than 8 MB.");
  if (response.status === 403) throw new Error("The local proxy blocked the Word upload. Install the latest FormFlow update, rebuild the containers, and try again.");
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    throw new Error("The local import service is temporarily unavailable. Wait a moment and try again.");
  }
  if (!response.ok) throw new Error(`The Word import failed on the server (HTTP ${response.status}). Check the FormFlow container log if it happens again.`);
  throw new Error("The server returned an invalid Word import response. Rebuild FormFlow with the latest update and try again.");
}

const blockId = () => `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function newBlock(type: DocumentBlockType): DocumentBlock {
  if (type === "heading1") return { id: blockId(), type, text: "New main heading" };
  if (type === "heading2") return { id: blockId(), type, text: "New subheading" };
  if (type === "heading3") return { id: blockId(), type, text: "New third-level heading" };
  if (type === "paragraph") return { id: blockId(), type, text: "", align: "justify" };
  if (type === "bullets") return { id: blockId(), type, items: [""] };
  if (type === "table") return { id: blockId(), type, headerRow: true, cells: [["Heading 1", "Heading 2"], ["", ""]] };
  if (type === "image") return { id: blockId(), type, caption: "" };
  if (type === "spacer") return { id: blockId(), type, spacerHeight: 18 };
  if (type === "signature") return { id: blockId(), type, text: "Prepared by\nReviewed by\nApproved by" };
  return { id: blockId(), type };
}

const tools: Array<{ type: DocumentBlockType; label: string; icon: typeof FileText }> = [
  { type: "heading1", label: "Heading 1", icon: Heading1 },
  { type: "heading2", label: "Heading 2", icon: Heading2 },
  { type: "heading3", label: "Heading 3", icon: Heading3 },
  { type: "paragraph", label: "Paragraph", icon: FileText },
  { type: "bullets", label: "Bullet list", icon: List },
  { type: "table", label: "Table", icon: Table2 },
  { type: "image", label: "Image", icon: FileImage },
  { type: "signature", label: "Approval block", icon: UserRoundCheck },
  { type: "divider", label: "Horizontal line", icon: Minus },
  { type: "spacer", label: "Spacer", icon: Space },
  { type: "page-break", label: "Page break", icon: SeparatorHorizontal },
];

function headingNumber(blocks: DocumentBlock[], index: number) {
  let first = 0;
  let second = 0;
  let third = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    if (blocks[cursor].type === "heading1") { first += 1; second = 0; third = 0; }
    if (blocks[cursor].type === "heading2") { second += 1; third = 0; }
    if (blocks[cursor].type === "heading3") third += 1;
  }
  const type = blocks[index].type;
  if (type === "heading1") return `${first}`;
  if (type === "heading2") return `${Math.max(first, 1)}.${second}`;
  if (type === "heading3") return `${Math.max(first, 1)}.${Math.max(second, 1)}.${third}`;
  return "";
}

function resizeTable(block: DocumentBlock, rows: number, columns: number) {
  const current = block.cells || [];
  const cells = Array.from({ length: Math.max(1, rows) }, (_, row) =>
    Array.from({ length: Math.max(1, columns) }, (_, column) => current[row]?.[column] || ""),
  );
  return { ...block, cells };
}

export function DocumentBuilder({
  builder, setBuilder, blocks, setBlocks, onSave, busy,
}: {
  builder: DocumentBuilderState;
  setBuilder: React.Dispatch<React.SetStateAction<DocumentBuilderState>>;
  blocks: DocumentBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<DocumentBlock[]>>;
  onSave: () => void;
  busy: boolean;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"auto" | "full">("auto");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const updateMeta = (changes: Partial<DocumentMeta>) => setBuilder((current) => ({ ...current, documentMeta: { ...current.documentMeta, ...changes } }));
  const updateBlock = (index: number, changes: Partial<DocumentBlock>) => setBlocks((current) => current.map((block, cursor) => cursor === index ? { ...block, ...changes } : block));
  const moveBlock = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) return;
    setBlocks((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; });
  };
  const headings = useMemo(() => blocks.filter((block) => block.type === "heading1"), [blocks]);

  const importWord = async () => {
    if (!importFile) { setImportError("Choose a Word DOCX file first."); return; }
    if (blocks.length && !window.confirm("Replace the current document body with the imported Word content?")) return;
    setImporting(true); setImportError("");
    try {
      const form = new FormData();
      form.append("file", importFile); form.append("mode", importMode);
      const response = await fetch("/api/document/import", { method: "POST", body: form });
      const data = await readImportResponse(response);
      if (!response.ok) throw new Error(data.error || "Unable to import this Word document.");
      setBlocks(data.blocks);
      setImportResult(data);
      setBuilder((current) => ({
        ...current,
        name: current.name || data.metadata.title,
        code: current.code || data.metadata.code,
        sourceImportId: data.source.importId,
        sourceFileName: data.source.fileName,
        sourceFileHash: data.source.sha256,
        importSummary: data.summary,
        changeDescription: current.baseTemplateId && !current.changeDescription ? `Imported content from ${data.source.fileName}` : current.changeDescription,
        documentMeta: {
          ...current.documentMeta,
          documentType: data.metadata.documentType || current.documentMeta.documentType,
          versionLabel: data.metadata.versionLabel || current.documentMeta.versionLabel,
          classification: data.metadata.classification || current.documentMeta.classification,
        },
      }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to import this Word document.");
    } finally { setImporting(false); }
  };

  const addPresetTable = (kind: "related" | "records") => {
    setBlocks((current) => [...current, kind === "related"
      ? { id: blockId(), type: "table", headerRow: true, caption: "Related documents, forms and registers", cells: [["Reference", "Title", "Relationship"], ["", "", ""]] }
      : { id: blockId(), type: "table", headerRow: true, caption: "Records and retention", cells: [["Record", "Owner", "Retention period", "Disposition"], ["", "", "", ""]] },
    ]);
  };

  return <div className="content document-builder-page">
    <div className="page-heading"><div><p className="eyebrow">Controlled documents</p><h1>{builder.editingTemplateId ? "Edit draft" : builder.baseTemplateId ? "Create a new version" : "Document builder"}</h1><p>Build policies, procedures, governance documents, manuals, and terms of reference as structured content blocks.</p></div><div className="heading-actions"><button className="button primary" onClick={onSave} disabled={busy}>{busy ? <span className="spin">◌</span> : <Save size={17} />}{builder.editingTemplateId ? "Update draft" : builder.baseTemplateId ? "Save new version" : "Save document"}</button></div></div>

    <section className="document-identity-card">
      <div className="document-controls-head"><div><FileText size={18} /><span><strong>Cover and control information</strong><small>This metadata fills the cover, header, footer, history table, and document register.</small></span></div><span className="house-style-pill">CCPL house style</span></div>
      <div className="metadata-grid document-metadata-grid">
        <label className="field-label wide"><span>Document title *</span><input value={builder.name} onChange={(event) => setBuilder((current) => ({ ...current, name: event.target.value }))} placeholder="Quality Policy" /></label>
        <label className="field-label"><span>Document ID *</span><input value={builder.code} onChange={(event) => setBuilder((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="CCPL-CB-POL-001" /></label>
        <label className="field-label"><span>Document type</span><select value={builder.documentMeta.documentType} onChange={(event) => updateMeta({ documentType: event.target.value })}><option>POLICY</option><option>PROCEDURE</option><option>GOVERNANCE</option><option>MANUAL</option><option>TERMS OF REFERENCE</option><option>GUIDELINE</option></select></label>
        <label className="field-label"><span>Version</span><input value={builder.documentMeta.versionLabel} onChange={(event) => updateMeta({ versionLabel: event.target.value })} placeholder="0.1" /></label>
        <label className="field-label"><span>Classification</span><select value={builder.documentMeta.classification} onChange={(event) => updateMeta({ classification: event.target.value })}><option>PUBLIC</option><option>INTERNAL</option><option>CONFIDENTIAL</option></select></label>
        <label className="field-label"><span>Status</span><input value="DRAFT — controlled by approval workflow" readOnly /></label>
        <label className="field-label"><span>Document owner</span><input value={builder.documentMeta.documentOwner} onChange={(event) => updateMeta({ documentOwner: event.target.value })} /></label>
        <label className="field-label"><span>Effective date</span><input type="date" value={builder.documentMeta.effectiveDate} onChange={(event) => updateMeta({ effectiveDate: event.target.value })} /></label>
        <label className="field-label"><span>Prepared by</span><input value={builder.documentMeta.preparedBy} readOnly /></label>
        <label className="field-label"><span>Reviewed by</span><input value={builder.documentMeta.reviewedBy} readOnly placeholder="Recorded by review workflow" /></label>
        <label className="field-label"><span>Approved by</span><input value={builder.documentMeta.approvedBy} readOnly placeholder="Recorded on Director approval" /></label>
        <label className="field-label"><span>Revision date</span><input type="date" value={builder.revisionDate} onChange={(event) => setBuilder((current) => ({ ...current, revisionDate: event.target.value }))} /></label>
        <label className="field-label wide"><span>Change description {builder.baseTemplateId ? "*" : ""}</span><input value={builder.changeDescription} onChange={(event) => setBuilder((current) => ({ ...current, changeDescription: event.target.value }))} placeholder={builder.baseTemplateId ? "Describe what changed in this version" : "Initial issue"} /></label>
        <label className="field-label wide"><span>Document summary</span><textarea rows={2} value={builder.description} onChange={(event) => setBuilder((current) => ({ ...current, description: event.target.value }))} placeholder="Short description shown in the document library" /></label>
      </div>
    </section>

    <section className="word-import-card">
      <div className="word-import-intro"><span className="word-import-icon"><FileUp size={22} /></span><div><p className="eyebrow">Import existing content</p><h2>Convert a Word document into editable blocks</h2><p>FormFlow detects headings, paragraphs, bullet lists, tables, pictures, and page breaks. The original DOCX is archived with its hash.</p></div></div>
      <div className="word-import-controls">
        <label className="word-file-picker"><UploadCloud size={20} /><span><strong>{importFile?.name || "Choose Word document"}</strong><small>.docx only, maximum 8 MB</small></span><input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { setImportFile(event.target.files?.[0] || null); setImportError(""); }} /></label>
        <label className="field-label import-mode"><span>Content to import</span><select value={importMode} onChange={(event) => setImportMode(event.target.value as "auto" | "full")}><option value="auto">Body only - remove cover, history, and contents</option><option value="full">Entire Word document</option></select></label>
        <button className="button primary" onClick={importWord} disabled={!importFile || importing}>{importing ? <Loader2 className="spin" size={17} /> : <FileUp size={17} />}{importing ? "Analysing document" : "Import and review"}</button>
      </div>
      {importError && <div className="word-import-error"><AlertTriangle size={16} />{importError}</div>}
      {importResult && <div className="word-import-result"><div><Check size={17} /><span><strong>{importResult.source.fileName} imported successfully</strong><small>{importResult.summary.totalBlocks} editable blocks detected{importResult.summary.removedFrontMatterBlocks ? `, ${importResult.summary.removedFrontMatterBlocks} front-matter blocks removed` : ""}. Review everything below before saving.</small></span></div><dl><div><dt>Headings</dt><dd>{importResult.summary.headings || 0}</dd></div><div><dt>Paragraphs</dt><dd>{importResult.summary.paragraphs || 0}</dd></div><div><dt>Tables</dt><dd>{importResult.summary.tables || 0}</dd></div><div><dt>Images</dt><dd>{importResult.summary.images || 0}</dd></div></dl>{importResult.warnings.length > 0 && <ul>{importResult.warnings.map((warning) => <li key={warning}><AlertTriangle size={14} />{warning}</li>)}</ul>}<small className="import-hash">SHA-256: {importResult.source.sha256}</small></div>}
      {!importResult && builder.sourceImportId && <div className="word-import-result compact"><div><Check size={17} /><span><strong>Imported source retained: {builder.sourceFileName}</strong><small>SHA-256: {builder.sourceFileHash}</small></span></div></div>}
    </section>

    <div className="document-workspace">
      <aside className="block-toolbox">
        <div><p className="eyebrow">Insert</p><h3>Content blocks</h3><span>Add blocks in reading order. Drag them later to rearrange the document.</span></div>
        <div className="block-tool-grid">{tools.map((tool) => { const Icon = tool.icon; return <button key={tool.type} onClick={() => setBlocks((current) => [...current, newBlock(tool.type)])}><Icon size={17} /><span>{tool.label}</span></button>; })}</div>
        <div className="preset-tools"><strong>Structured tables</strong><button onClick={() => addPresetTable("related")}><Columns3 size={15} />Related documents</button><button onClick={() => addPresetTable("records")}><Rows3 size={15} />Records and retention</button></div>
        <div className="document-plan"><strong>Generated pages</strong><ol><li>Title page</li><li>Document History</li><li>Table of Contents</li><li>Body content</li></ol><span>{headings.length} main heading{headings.length === 1 ? "" : "s"} will appear in the contents page.</span></div>
      </aside>

      <section className="document-canvas">
        <div className="document-canvas-head"><div><p className="eyebrow">Body content</p><h2>Page 4 onward</h2></div><span>{blocks.length} block{blocks.length === 1 ? "" : "s"}</span></div>
        {!blocks.length && <div className="document-empty"><FileText size={30} /><strong>Start with a main heading</strong><p>Add Heading 1, then place paragraphs, bullets, and tables below it.</p><button className="button primary small" onClick={() => setBlocks([newBlock("heading1"), newBlock("paragraph")])}><Plus size={16} />Add starter blocks</button></div>}
        <div className="document-block-list">{blocks.map((block, index) => <article className={`document-block block-${block.type}`} key={block.id} draggable onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged !== null) moveBlock(dragged, index); setDragged(null); }}>
          <div className="block-bar"><span className="block-drag"><GripVertical size={16} /></span><strong>{block.type.startsWith("heading") ? `Heading ${block.type.slice(-1)} ${headingNumber(blocks, index)}` : tools.find((tool) => tool.type === block.type)?.label}</strong><div><button onClick={() => moveBlock(index, index - 1)} disabled={index === 0} aria-label="Move block up"><ArrowUp size={14} /></button><button onClick={() => moveBlock(index, index + 1)} disabled={index === blocks.length - 1} aria-label="Move block down"><ArrowDown size={14} /></button><button onClick={() => setBlocks((current) => [...current.slice(0, index + 1), { ...block, id: blockId(), cells: block.cells?.map((row) => [...row]), items: block.items ? [...block.items] : undefined }, ...current.slice(index + 1)])} aria-label="Duplicate block"><Copy size={14} /></button><button className="danger" onClick={() => setBlocks((current) => current.filter((_, cursor) => cursor !== index))} aria-label="Delete block"><Trash2 size={14} /></button></div></div>

          {block.type.startsWith("heading") && <div className="heading-block-input"><span>{headingNumber(blocks, index)}</span><input value={block.text || ""} onChange={(event) => updateBlock(index, { text: event.target.value })} /></div>}
          {block.type === "paragraph" && <><div className="format-toolbar"><button className={block.bold ? "active" : ""} onClick={() => updateBlock(index, { bold: !block.bold })}><Bold size={15} /></button><button className={block.italic ? "active" : ""} onClick={() => updateBlock(index, { italic: !block.italic })}><Italic size={15} /></button><button className={block.underline ? "active" : ""} onClick={() => updateBlock(index, { underline: !block.underline })}><Underline size={15} /></button><i /><button className={block.align === "left" ? "active" : ""} onClick={() => updateBlock(index, { align: "left" })}><AlignLeft size={15} /></button><button className={block.align === "center" ? "active" : ""} onClick={() => updateBlock(index, { align: "center" })}><AlignCenter size={15} /></button><button className={block.align === "right" ? "active" : ""} onClick={() => updateBlock(index, { align: "right" })}><AlignRight size={15} /></button><button className={!block.align || block.align === "justify" ? "active" : ""} onClick={() => updateBlock(index, { align: "justify" })}><AlignJustify size={15} /></button></div><textarea className="document-paragraph-input" rows={5} value={block.text || ""} onChange={(event) => updateBlock(index, { text: event.target.value })} placeholder="Write the paragraph content here. It will use 1.5 line spacing in Word and PDF." /></>}
          {block.type === "bullets" && <textarea className="document-paragraph-input" rows={4} value={(block.items || []).join("\n")} onChange={(event) => updateBlock(index, { items: event.target.value.split("\n") })} placeholder="One bullet point per line" />}
          {block.type === "table" && <div className="table-block-editor"><div className="table-controls"><label>Rows <input type="number" min={1} max={20} value={block.cells?.length || 1} onChange={(event) => updateBlock(index, resizeTable(block, Number(event.target.value), block.cells?.[0]?.length || 1))} /></label><label>Columns <input type="number" min={1} max={8} value={block.cells?.[0]?.length || 1} onChange={(event) => updateBlock(index, resizeTable(block, block.cells?.length || 1, Number(event.target.value)))} /></label><label className="compact-check"><input type="checkbox" checked={block.headerRow !== false} onChange={(event) => updateBlock(index, { headerRow: event.target.checked })} />Header row</label><input className="table-caption" value={block.caption || ""} onChange={(event) => updateBlock(index, { caption: event.target.value })} placeholder="Optional table title" /></div><div className="editable-table"><table><tbody>{(block.cells || []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex}><textarea rows={2} value={cell} onChange={(event) => { const cells = (block.cells || []).map((source) => [...source]); cells[rowIndex][columnIndex] = event.target.value; updateBlock(index, { cells }); }} /></td>)}</tr>)}</tbody></table></div></div>}
          {block.type === "image" && <div className="image-block-editor">{block.imageDataUrl ? <img src={block.imageDataUrl} alt={block.caption || "Document image preview"} /> : <label><UploadCloud size={24} /><strong>Upload image</strong><span>PNG or JPG. Images are stored inside this controlled document version.</span><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => updateBlock(index, { imageDataUrl: String(reader.result || "") }); reader.readAsDataURL(file); }} /></label>}<input value={block.caption || ""} onChange={(event) => updateBlock(index, { caption: event.target.value })} placeholder="Image caption" /></div>}
          {block.type === "divider" && <div className="divider-preview" />}
          {block.type === "spacer" && <label className="spacer-control">Spacing height <input type="range" min={6} max={72} value={block.spacerHeight || 18} onChange={(event) => updateBlock(index, { spacerHeight: Number(event.target.value) })} /><strong>{block.spacerHeight || 18} pt</strong></label>}
          {block.type === "page-break" && <div className="page-break-preview"><span>Manual page break</span></div>}
          {block.type === "signature" && <textarea className="document-paragraph-input" rows={3} value={block.text || ""} onChange={(event) => updateBlock(index, { text: event.target.value })} placeholder="One approval role per line" />}
        </article>)}</div>
      </section>
    </div>
    <div className="sticky-actions document-save-bar"><div><Check size={15} />Earlier versions remain in Document History and the document register.</div><button className="button primary" onClick={onSave} disabled={busy}><Save size={17} />{builder.baseTemplateId ? "Save controlled revision" : "Save controlled document"}</button></div>
  </div>;
}
