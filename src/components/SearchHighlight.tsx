import React from 'react';

interface SearchHighlightProps {
  text: string;
  searchQuery: string;
  className?: string;
}

export default function SearchHighlight({ text, searchQuery, className = '' }: SearchHighlightProps) {
  if (!searchQuery.trim()) {
    return <span className={className}>{text}</span>;
  }

  const parts: { text: string; highlight: boolean }[] = [];
  const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
  const matches = text.split(regex);

  matches.forEach((part, index) => {
    if (part) {
      const isMatch = regex.test(part);
      regex.lastIndex = 0; // Reset regex state
      parts.push({ text: part, highlight: isMatch });
    }
  });

  return (
    <span className={className}>
      {parts.map((part, index) => 
        part.highlight ? (
          <mark 
            key={index} 
            className="bg-yellow-300 text-gray-900 px-1 rounded"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </span>
  );
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

