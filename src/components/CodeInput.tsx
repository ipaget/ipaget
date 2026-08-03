import { useState, useRef, useEffect, KeyboardEvent } from "react";

interface CodeInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}

export default function CodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
}: CodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const normalizedValue = value.slice(0, length).padEnd(length, " ");

  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  useEffect(() => {
    if (value.length === length && onComplete) {
      onComplete(value);
    }
  }, [value, length, onComplete]);

  const handleChange = (index: number, digit: string) => {
    if (disabled) return;

    if (!/^\d*$/.test(digit)) return;

		const nextChars = normalizedValue.split("");
		nextChars[index] = digit.slice(-1) || " ";
		const updatedValue = nextChars.join("").replace(/\s+$/g, "");

    onChange(updatedValue);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === "Backspace") {
      e.preventDefault();
    const nextChars = normalizedValue.split("");
    if ((normalizedValue[index] || " ") !== " ") {
      nextChars[index] = " ";
      onChange(nextChars.join("").replace(/\s+$/g, ""));
      return;
    }

    if (index > 0) {
      nextChars[index - 1] = " ";
      onChange(nextChars.join("").replace(/\s+$/g, ""));
      inputRefs.current[index - 1]?.focus();
    }

    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disabled) return;

    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").replace(/\D/g, "");
    const newValue = pastedData.slice(0, length);
    onChange(newValue);

    const nextIndex = Math.min(newValue.length, length - 1);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleFocus = (index: number) => {
    setFocusedIndex(index);
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => (inputRefs.current[index] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
			  value={normalizedValue[index] === " " ? "" : normalizedValue[index]}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          className={`w-12 h-14 text-center text-2xl font-semibold border-2 rounded-lg transition-all
            ${
              error
                ? "border-red-500"
                : focusedIndex === index && !disabled
                ? "border-blue-500 ring-2 ring-blue-200"
                : "border-gray-300"
            }
            bg-white
            ${disabled ? "opacity-50 cursor-not-allowed" : ""}
            focus:outline-none
            text-gray-900
          `}
        />
      ))}
    </div>
  );
}

