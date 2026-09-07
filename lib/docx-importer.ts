import { DOMParser, type Document, type Node, type Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { DocumentBlock, DocumentBlockType } from "./form-store";

type ImportMode = "auto" | "full";

export type ImportedDocument = {
  blocks: DocumentBlock[];
  metadata: {
    title: string;
    code: string;
    versionLabel: string;
    documentType: string;
    classification: string;
  };
  warnings: string[];
  summary: {
    totalBlocks: number;
    removedFrontMatterBlocks: number;
    headings: number;
    paragraphs: number;
    bulletLists: number;
    tables: number;
    images: number;
    pageBreaks: number;
  };
};

const wordPrefix = (name: string) => name.includes(":") ? name : `w:${name}`;
const elementChildren = (node: Node) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
const directChildren = (node: Node, name: string) => elementChildren(node).filter((child) => child.nodeName === wordPrefix(name) || child.localName === name);
const firstDirect = (node: Node, name: string) => directChildren(node, name)[0];
const descendants = (node: Node, name: string) => Array.from((node as Element).getElementsByTagName?.(wordPrefix(name)) || []);
const attribute = (node: Element | undefined, name: string) => node?.getAttribute(`w:${name}`) || node?.getAttribute(`r:${name}`) || node?.getAttribute(name) || "";
const clean = (value: unknown) => String(value ?? "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\t\r]+/g, " ").replace(/ {2,}/g, " ").trim();
const importId = () => `block_${crypto.randomUUID()}`;

function parseXml(value: string, label: string) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error(`The ${label} XML inside this Word file is invalid.`);
  return document;
}

function paragraphText(paragraph: Element) {
  let text = "";
  let pageBreak = false;
  const visit = (node: Node) => {
    if (node.nodeType === 1) {
      const element = node as Element;
      if (element.nodeName === "w:t" || element.localName === "t") text += element.textContent || "";
      else if (element.nodeName === "w:tab" || element.localName === "tab") text += "\t";
      else if (element.nodeName === "w:br" || element.localName === "br") {
        if (attribute(element, "type") === "page") pageBreak = true;
        else text += "\n";
      }
    }
    Array.from(node.childNodes || []).forEach(visit);
  };
  visit(paragraph);
  return { text: clean(text), pageBreak };
}

function styleMap(stylesDocument: Document | null) {
  const styles = new Map<string, string>();
  if (!stylesDocument) return styles;
  for (const style of Array.from(stylesDocument.getElementsByTagName("w:style"))) {
    if (attribute(style, "type") !== "paragraph") continue;
    const styleId = attribute(style, "styleId");
    const name = attribute(descendants(style, "name")[0] as Element | undefined, "val");
    if (styleId) styles.set(styleId.toLowerCase(), name.toLowerCase());
  }
  return styles;
}

function headingLevel(paragraph: Element, text: string, styles: Map<string, string>) {
  const properties = firstDirect(paragraph, "pPr");
  const styleId = attribute(firstDirect(properties || paragraph, "pStyle"), "val");
  const styleName = styles.get(styleId.toLowerCase()) || styleId.toLowerCase();
  const normalized = `${styleId} ${styleName}`.replace(/[ _-]+/g, "").toLowerCase();
  for (const level of [1, 2, 3]) {
    if (normalized.includes(`heading${level}`) || normalized === `h${level}`) return level;
  }
  const outlineValue = attribute(descendants(properties || paragraph, "outlineLvl")[0] as Element | undefined, "val");
  const outline = outlineValue === "" ? Number.NaN : Number(outlineValue);
  if (Number.isInteger(outline) && outline >= 0 && outline <= 2) return outline + 1;

  const numbered = text.match(/^\s*(\d+(?:\.\d+){0,2})[.)]?\s+(.+)$/);
  const bold = descendants(paragraph, "b").length > 0;
  if (numbered && text.length <= 180 && (bold || /^\d+(?:\.\d+){0,2}[.)]?\s+[A-Z]/.test(text))) return Math.min(3, numbered[1].split(".").length);
  return 0;
}

function stripHeadingNumber(text: string) {
  return clean(text.replace(/^\s*\d+(?:\.\d+){0,2}[.)]?\s+/, ""));
}

function paragraphFormatting(paragraph: Element) {
  const properties = firstDirect(paragraph, "pPr");
  const alignmentValue = attribute(firstDirect(properties || paragraph, "jc"), "val").toLowerCase();
  const align = (["left", "center", "right", "justify"].includes(alignmentValue) ? alignmentValue : "justify") as DocumentBlock["align"];
  return {
    align,
    bold: descendants(paragraph, "b").length > 0,
    italic: descendants(paragraph, "i").length > 0,
    underline: descendants(paragraph, "u").some((node) => attribute(node as Element, "val") !== "none"),
  };
}

function relationshipMap(relationshipsDocument: Document | null) {
  const relationships = new Map<string, string>();
  if (!relationshipsDocument) return relationships;
  for (const relationship of Array.from(relationshipsDocument.getElementsByTagName("Relationship"))) {
    const id = relationship.getAttribute("Id") || "";
    const target = relationship.getAttribute("Target") || "";
    if (id && target && !target.includes("..")) relationships.set(id, target.replace(/^\//, ""));
  }
  return relationships;
}

function mimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  return "image/png";
}

async function imageBlocks(paragraph: Element, zip: JSZip, relationships: Map<string, string>) {
  const blocks: DocumentBlock[] = [];
  const seen = new Set<string>();
  const blips = [
    ...Array.from(paragraph.getElementsByTagName("a:blip")),
    ...Array.from(paragraph.getElementsByTagName("v:imagedata")),
  ];
  for (const blip of blips) {
    const relationshipId = blip.getAttribute("r:embed") || blip.getAttribute("r:id") || "";
    if (!relationshipId || seen.has(relationshipId)) continue;
    seen.add(relationshipId);
    const target = relationships.get(relationshipId);
    if (!target) continue;
    const path = target.startsWith("word/") ? target : `word/${target}`;
    const entry = zip.file(path);
    if (!entry) continue;
    const base64 = await entry.async("base64");
    blocks.push({ id: importId(), type: "image", imageDataUrl: `data:${mimeType(path)};base64,${base64}`, caption: "" });
  }
  return blocks;
}

function tableBlock(table: Element): DocumentBlock | null {
  const rows = directChildren(table, "tr").map((row) => directChildren(row, "tc").map((cell) => {
    const paragraphs = descendants(cell, "p").map((paragraph) => paragraphText(paragraph as Element).text).filter(Boolean);
    return clean(paragraphs.join("\n"));
  }));
  if (!rows.length || !rows.some((row) => row.some(Boolean))) return null;
  return { id: importId(), type: "table", headerRow: true, cells: rows };
}

function isFrontMatterLabel(block: DocumentBlock, pattern: RegExp) {
  if (!["heading1", "heading2", "heading3", "paragraph"].includes(block.type)) return false;
  return pattern.test(clean(block.text).toLowerCase());
}

function trimFrontMatter(blocks: DocumentBlock[]) {
  const contentsIndex = blocks.findIndex((block) => isFrontMatterLabel(block, /^(table of contents|contents)$/i));
  const historyIndex = blocks.findIndex((block) => isFrontMatterLabel(block, /^(document history|revision history|version history)$/i));
  const marker = contentsIndex >= 0 ? contentsIndex : historyIndex;
  if (marker >= 0) {
    const breakIndex = blocks.findIndex((block, index) => index > marker && block.type === "page-break");
    const searchFrom = breakIndex >= 0 ? breakIndex + 1 : marker + 1;
    const bodyHeading = blocks.findIndex((block, index) => index >= searchFrom && block.type === "heading1");
    if (bodyHeading >= 0) return { blocks: blocks.slice(bodyHeading), removed: bodyHeading };
  }

  const breaks = blocks.map((block, index) => block.type === "page-break" ? index : -1).filter((index) => index >= 0);
  if (breaks.length >= 2) {
    const searchFrom = breaks[1] + 1;
    const bodyHeading = blocks.findIndex((block, index) => index >= searchFrom && block.type === "heading1");
    if (bodyHeading >= 0) return { blocks: blocks.slice(bodyHeading), removed: bodyHeading };
  }
  return { blocks, removed: 0 };
}

function metadataFrom(coreDocument: Document | null, allText: string) {
  const coreTitle = coreDocument?.getElementsByTagName("dc:title")[0]?.textContent || "";
  const code = allText.match(/\bCCPL-[A-Z0-9-]{4,}\b/i)?.[0]?.toUpperCase() || "";
  const versionLabel = allText.match(/\bVersion\s*:?[ ]*(\d+(?:\.\d+)+)\b/i)?.[1] || "";
  const upper = `${coreTitle}\n${allText.slice(0, 1800)}`.toUpperCase();
  const documentType = code.includes("-PROC-") ? "PROCEDURE" : code.includes("-POL-") ? "POLICY" : code.includes("-MAN-") ? "MANUAL" : upper.includes("PROCEDURE") ? "PROCEDURE" : upper.includes("MANUAL") ? "MANUAL" : upper.includes("GOVERNANCE") ? "GOVERNANCE" : upper.includes("GUIDELINE") ? "GUIDELINE" : "POLICY";
  const classification = upper.match(/(?:^|\n)\s*(PUBLIC|INTERNAL|CONFIDENTIAL)\s*(?:\n|$)/)?.[1] || "";
  return { title: clean(coreTitle), code, versionLabel, documentType, classification };
}

export async function importDocx(bytes: Uint8Array, mode: ImportMode): Promise<ImportedDocument> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("This file does not contain a readable Word document body.");
  const documentXml = await documentEntry.async("string");
  if (documentXml.length > 12_000_000) throw new Error("The Word document body is too large to import safely.");

  const optionalXml = async (path: string) => zip.file(path) ? parseXml(await zip.file(path)!.async("string"), path) : null;
  const document = parseXml(documentXml, "document");
  const styles = styleMap(await optionalXml("word/styles.xml"));
  const relationships = relationshipMap(await optionalXml("word/_rels/document.xml.rels"));
  const coreDocument = await optionalXml("docProps/core.xml");
  const body = document.getElementsByTagName("w:body")[0];
  if (!body) throw new Error("The Word document body is empty.");

  const warnings: string[] = [];
  if (document.getElementsByTagName("w:del").length || document.getElementsByTagName("w:ins").length) warnings.push("Tracked changes were detected. Accepted text was imported and deleted text was omitted where possible.");
  if (document.getElementsByTagName("w:txbxContent").length) warnings.push("Text boxes were detected. Review their imported position and content.");
  if (document.getElementsByTagName("w:gridSpan").length || document.getElementsByTagName("w:vMerge").length) warnings.push("Merged table cells were flattened into a standard editable grid.");

  const blocks: DocumentBlock[] = [];
  let pendingBullets: string[] = [];
  const flushBullets = () => {
    if (!pendingBullets.length) return;
    blocks.push({ id: importId(), type: "bullets", items: pendingBullets });
    pendingBullets = [];
  };

  for (const child of elementChildren(body)) {
    if (child.nodeName === "w:p" || child.localName === "p") {
      const { text, pageBreak } = paragraphText(child);
      const images = await imageBlocks(child, zip, relationships);
      const properties = firstDirect(child, "pPr");
      const isList = descendants(properties || child, "numPr").length > 0;
      const level = text ? headingLevel(child, text, styles) : 0;

      if (text && isList && level === 0) pendingBullets.push(text.replace(/^\s*[•·\-]\s*/, ""));
      else {
        flushBullets();
        if (text && level > 0) blocks.push({ id: importId(), type: `heading${level}` as DocumentBlockType, text: stripHeadingNumber(text) });
        else if (text) blocks.push({ id: importId(), type: "paragraph", text, ...paragraphFormatting(child) });
      }
      if (images.length) { flushBullets(); blocks.push(...images); }
      if (pageBreak || descendants(properties || child, "sectPr").length) { flushBullets(); blocks.push({ id: importId(), type: "page-break" }); }
    } else if (child.nodeName === "w:tbl" || child.localName === "tbl") {
      flushBullets();
      const table = tableBlock(child);
      if (table) blocks.push(table);
    } else if (child.nodeName === "w:sectPr" || child.localName === "sectPr") {
      flushBullets();
    }
  }
  flushBullets();

  const compactBlocks = blocks.filter((block, index) => !(block.type === "page-break" && (index === 0 || blocks[index - 1]?.type === "page-break")));
  const trimmed = mode === "auto" ? trimFrontMatter(compactBlocks) : { blocks: compactBlocks, removed: 0 };
  const finalBlocks = trimmed.blocks.filter((block, index, list) => !(block.type === "page-break" && (index === list.length - 1 || list[index - 1]?.type === "page-break")));
  const headings = finalBlocks.filter((block) => block.type.startsWith("heading")).length;
  if (!headings) warnings.push("No Word heading styles were detected. Review short bold paragraphs and change them to Heading blocks where required.");
  if (!finalBlocks.length) throw new Error("No importable body content was detected. Try importing the entire document instead of automatically removing front matter.");

  const allText = compactBlocks.map((block) => block.text || block.items?.join(" ") || block.cells?.flat().join(" ") || "").join("\n");
  const summary = {
    totalBlocks: finalBlocks.length,
    removedFrontMatterBlocks: trimmed.removed,
    headings,
    paragraphs: finalBlocks.filter((block) => block.type === "paragraph").length,
    bulletLists: finalBlocks.filter((block) => block.type === "bullets").length,
    tables: finalBlocks.filter((block) => block.type === "table").length,
    images: finalBlocks.filter((block) => block.type === "image").length,
    pageBreaks: finalBlocks.filter((block) => block.type === "page-break").length,
  };
  return { blocks: finalBlocks, metadata: metadataFrom(coreDocument, allText), warnings, summary };
}
