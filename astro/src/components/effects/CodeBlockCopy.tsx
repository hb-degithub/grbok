import React from 'react';

export default function CodeBlockWrapper({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    const text = extractText(children);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <div className="relative group">
      <button onClick={handleCopy} className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800/80 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200" aria-label={copied ? "已复制" : "复制代码"}>
        {copied ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        )}
      </button>
      {children}
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}
