import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bullet: '-'
});

// Preserve <u> tags exactly
turndownService.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`
});

// Preserve embedded insight cards exactly
turndownService.addRule('embeddedInsight', {
  filter: (node) => {
    return node.nodeName === 'DIV' && node.classList.contains('embedded-insight');
  },
  replacement: (_content, node) => {
    return '\n\n' + (node as any).outerHTML.trim() + '\n\n';
  }
});

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownService.turndown(html);
}

export function markdownToHtml(md: string): string {
  if (!md) return '';

  // Protect embedded insight cards from markdown replacement
  const htmlBlocks: string[] = [];
  let placeholderCounter = 0;

  const cleanedMd = md.replace(/<div class="embedded-insight[\s\S]*?<\/div>\s*(<p><br><\/p>)?/g, (match) => {
    htmlBlocks.push(match);
    return `<!--EMBEDDED_INSIGHT_PLACEHOLDER_${placeholderCounter++}-->`;
  });

  let html = cleanedMd;

  // Let's replace basic markdown inline tags:
  
  // Headers (h1, h2, h3)
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');

  // Unordered Lists
  html = html.replace(/^[-\*] (.*?)$/gm, '<li>$1</li>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italics
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');

  // Underline
  html = html.replace(/~~(.*?)~~/g, '<u>$1</u>');

  // Let's convert plain text paragraphs:
  const lines = html.split(/\n/);
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '<p><br></p>';
    }

    // Check if it's already a block tag
    if (/^<(h1|h2|h3|blockquote|li|div|p)/i.test(trimmed) || trimmed.startsWith('<!--EMBEDDED_INSIGHT_PLACEHOLDER_')) {
      return trimmed;
    }

    return `<p>${line}</p>`;
  });
  
  html = processedLines.join('\n');

  // Restore embedded insights
  html = html.replace(/<!--EMBEDDED_INSIGHT_PLACEHOLDER_(\d+)-->/g, (_match, index) => {
    return htmlBlocks[parseInt(index, 10)] || '';
  });

  return html;
}
