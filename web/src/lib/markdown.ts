import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

// Open external links safely in a new tab
marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (href && /^artifact:/i.test(href)) {
        const relPath = href.replace(/^artifact:/i, "").replace(/^\/+/, "");
        const safePath = relPath.replace(/"/g, "&quot;");
        const plainTitle = text.replace(/<[^>]+>/g, "").trim() || relPath;
        const safeTitle = plainTitle.replace(/"/g, "&quot;");
        const ext = (relPath.split(".").pop() || "artifact").toUpperCase();
        return `<button type="button" class="otto-artifact-card" data-artifact-path="${safePath}" data-artifact-title="${safeTitle}"><span class="otto-artifact-card-title">${text}</span><span class="otto-artifact-card-meta">${ext} · Open</span></button>`;
      }
      const safeHref = href && /^https?:\/\//i.test(href) ? href : "#";
      const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    table(token) {
      const headerCells = token.header
        .map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`)
        .join("");
      const bodyRows = token.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`
        )
        .join("");
      return `<div class="md-table-wrap"><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
    },
  },
});

export function renderMarkdown(md: string): string {
  const rawHtml = marked.parse(String(md || ""), { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ["button"],
    ADD_ATTR: ["target", "rel", "type", "data-artifact-path", "data-artifact-title"],
  });
}
