function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMarkdown(md: string): string {
  const codeBlocks: string[] = [];
  const text = String(md || "").replace(
    /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g,
    (_, _lang: string, code: string) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    }
  );

  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  const inline = (s: string): string => {
    let e = escapeHtml(s);
    e = e.replace(/`([^`]+)`/g, "<code>$1</code>");
    e = e.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    e = e.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return e;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const cb = line.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (cb) {
      closeLists();
      out.push(codeBlocks[Number(cb[1])]);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeLists();
      out.push("<hr>");
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeLists();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      closeLists();
      out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (line.trim() === "") {
      closeLists();
      continue;
    }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists();
  return out.join("\n");
}
