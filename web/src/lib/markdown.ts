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
      if (href && /^studio-app:/i.test(href)) {
        const slug = href.replace(/^studio-app:/i, "").replace(/^\/+/, "").trim();
        const safeSlug = slug.replace(/"/g, "&quot;");
        const plainTitle = text.replace(/<[^>]+>/g, "").trim() || slug;
        const safeTitle = plainTitle.replace(/"/g, "&quot;");
        return `<button type="button" class="otto-artifact-card" data-studio-app-slug="${safeSlug}" data-studio-app-title="${safeTitle}"><span class="otto-artifact-card-title">${text}</span><span class="otto-artifact-card-meta">App · Open</span></button>`;
      }
      if (href && /^obs-overlay:/i.test(href)) {
        const slug = href.replace(/^obs-overlay:/i, "").replace(/^\/+/, "").trim();
        const safeSlug = slug.replace(/"/g, "&quot;");
        const plainTitle = text.replace(/<[^>]+>/g, "").trim() || slug;
        const safeTitle = plainTitle.replace(/"/g, "&quot;");
        return `<button type="button" class="otto-artifact-card" data-obs-overlay-slug="${safeSlug}" data-obs-overlay-title="${safeTitle}"><span class="otto-artifact-card-title">${text}</span><span class="otto-artifact-card-meta">OBS Overlay · Open</span></button>`;
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
    ADD_ATTR: [
      "target",
      "rel",
      "type",
      "data-studio-app-slug",
      "data-studio-app-title",
      "data-obs-overlay-slug",
      "data-obs-overlay-title",
    ],
  });
}
