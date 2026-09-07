import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun,
} from "docx";
import { GET, POST } from "../app/api/document/import/route";

type StoredImport = {
  id: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  chunks: Map<number, ArrayBuffer>;
};

const imports = new Map<string, StoredImport>();

class MockStatement {
  private values: unknown[] = [];
  constructor(private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async run() {
    if (this.sql.includes("INSERT INTO document_imports")) {
      imports.set(String(this.values[0]), {
        id: String(this.values[0]),
        fileName: String(this.values[1]),
        mimeType: String(this.values[2]),
        data: this.values[5] as ArrayBuffer,
        chunks: new Map(),
      });
    }
    if (this.sql.includes("INSERT INTO document_import_chunks")) {
      imports.get(String(this.values[0]))?.chunks.set(Number(this.values[1]), this.values[2] as ArrayBuffer);
    }
    return { success: true };
  }
  async all<T>() {
    if (this.sql.includes("PRAGMA table_info(templates)")) {
      const names = ["document_meta", "content_schema", "change_description", "revision_date", "base_template_id", "source_import_id", "source_file_name", "source_file_hash", "import_summary"];
      return { results: names.map((name) => ({ name })) as T[] };
    }
    if (this.sql.includes("SELECT chunk_data FROM document_import_chunks")) {
      const stored = imports.get(String(this.values[0]));
      const results = stored ? [...stored.chunks.entries()].sort(([left], [right]) => left - right).map(([, chunkData]) => ({ chunk_data: chunkData })) : [];
      return { results: results as T[] };
    }
    return { results: [] as T[] };
  }
  async first<T>() {
    if (this.sql.includes("SELECT file_name, mime_type, file_size, file_data FROM document_imports")) {
      const stored = imports.get(String(this.values[0]));
      const fileSize = stored ? [...stored.chunks.values()].reduce((total, chunk) => total + chunk.byteLength, stored.data.byteLength) : 0;
      return stored ? { file_name: stored.fileName, mime_type: stored.mimeType, file_size: fileSize, file_data: stored.data } as T : null;
    }
    return null;
  }
}

const mockDatabase = {
  prepare(sql: string) { return new MockStatement(sql); },
  async batch(statements: MockStatement[]) { for (const statement of statements) await statement.run(); return []; },
};
(globalThis as unknown as { __FORMFLOW_DB__: unknown }).__FORMFLOW_DB__ = mockDatabase;

const document = new Document({
  title: "Imported Quality Policy",
  numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: "bullet", text: "•", alignment: "left" }] }] },
  sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: "COMMON CRITERIA PAKISTAN LAB", bold: true })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ children: [new TextRun({ text: "Document History", bold: true })] }),
    new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Version")] }), new TableCell({ children: [new Paragraph("Change")]} )] })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ children: [new TextRun({ text: "Table of Contents", bold: true })] }),
    new Paragraph("1. Purpose"),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Purpose")] }),
    new Paragraph("This policy defines the controlled Word import test."),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Responsibilities")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("The document owner reviews imported content.")] }),
    new Table({ rows: [
      new TableRow({ children: [new TableCell({ children: [new Paragraph("Role")] }), new TableCell({ children: [new Paragraph("Responsibility")] })] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph("Owner")] }), new TableCell({ children: [new Paragraph("Review")]} )] }),
    ] }),
  ] }],
});

const packed = await Packer.toBuffer(document);
const archive = await JSZip.loadAsync(packed);
const filler = new Uint8Array(2_500_000);
let value = 0x13579bdf;
for (let index = 0; index < filler.length; index += 1) {
  value = (value * 1664525 + 1013904223) >>> 0;
  filler[index] = value & 0xff;
}
archive.file("word/media/large-import-test.bin", filler, { compression: "STORE" });
const bytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
assert.ok(bytes.byteLength > 2_000_000, "The smoke test must exercise a DOCX larger than a single database value.");
const form = new FormData();
form.append("mode", "auto");
form.append("file", new File([bytes as BlobPart], "CCPL-CB-POL-999-import-test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
const response = await POST(new Request("http://formflow.local/api/document/import", { method: "POST", body: form }));
assert.equal(response.status, 200);
const result = await response.json() as { source: { importId: string }; blocks: Array<{ type: string; text?: string }>; summary: { removedFrontMatterBlocks: number } };
assert.ok(result.summary.removedFrontMatterBlocks > 0);
assert.equal(result.blocks[0]?.type, "heading1");
assert.equal(result.blocks[0]?.text, "Purpose");
assert.ok(result.blocks.some((block) => block.type === "heading2"));
assert.ok(result.blocks.some((block) => block.type === "bullets"));
assert.ok(result.blocks.some((block) => block.type === "table"));

const download = await GET(new Request(`http://formflow.local/api/document/import?id=${result.source.importId}`));
assert.equal(download.status, 200);
assert.equal((await download.arrayBuffer()).byteLength, bytes.byteLength);
assert.ok(imports.get(result.source.importId)!.chunks.size > 1);
console.log(JSON.stringify({ importedBlocks: result.blocks.length, archivedBytes: bytes.byteLength, archiveChunks: imports.get(result.source.importId)!.chunks.size, status: "passed" }));
