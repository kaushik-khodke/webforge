const STOP = new Set("a an the and or to of in on for with is are was were what how my me i you your this that from about can do does have has it its".split(" "));

export function chunkText(text, size = 2800, overlap = 300) {
  const normalized = String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const result = [];
  for (let start = 0; start < normalized.length; start += size - overlap) {
    result.push(normalized.slice(start, start + size));
    if (start + size >= normalized.length) break;
  }
  return result;
}

function words(text) {
  return [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word => !STOP.has(word));
}

export function searchTerms(text) {
  return words(text).slice(0, 12).join(" OR ");
}

export function rankChunks(query, chunks, limit = 6) {
  const terms = words(query);
  return chunks.map(chunk => {
    const lower = chunk.content.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 + Math.min(lower.split(term).length - 1, 3) * 0.2 : 0), 0);
    return { ...chunk, score };
  }).filter(chunk => chunk.score > 0 || !terms.length)
    .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index)
    .slice(0, limit);
}
