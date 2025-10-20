import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  size?: number;
  className?: string;
}

export default function CopyButton({ text, size = 14, className = "" }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`flex-shrink-0 p-1 text-gray-400 hover:text-primary-600 transition-all duration-200 ${className}`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <Copy
          size={size}
          className={`absolute inset-0 transition-all duration-300 ${
            isCopied ? "opacity-0 scale-0 rotate-180" : "opacity-100 scale-100 rotate-0"
          }`}
        />
        <Check
          size={size}
          className={`absolute inset-0 transition-all duration-300 text-green-600 ${
            isCopied ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-0 rotate-180"
          }`}
        />
      </div>
    </button>
  );
}

