import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  className = "",
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={selectRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full px-4 py-2.5 bg-white border rounded-lg
          flex items-center justify-between gap-3
          transition-all duration-200
          ${disabled 
            ? "opacity-50 cursor-not-allowed bg-gray-50" 
            : "hover:border-primary-400 cursor-pointer"
          }
          ${isOpen 
            ? "border-primary-500 ring-2 ring-primary-200" 
            : "border-gray-300"
          }
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedOption?.icon && (
            <span className="flex-shrink-0">{selectedOption.icon}</span>
          )}
          <span className="text-gray-900 font-medium truncate">
            {selectedOption?.label || placeholder}
          </span>
        </div>
        <ChevronDown
          size={18}
          className={`flex-shrink-0 text-gray-500 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="py-1 max-h-64 overflow-y-auto">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`
                    w-full px-4 py-2.5 flex items-center gap-3
                    transition-colors duration-150
                    ${isSelected 
                      ? "bg-primary-50 text-primary-700" 
                      : "hover:bg-gray-50 text-gray-900"
                    }
                  `}
                >
                  {option.icon && (
                    <span className="flex-shrink-0">{option.icon}</span>
                  )}
                  <span className="flex-1 text-left font-medium truncate">
                    {option.label}
                  </span>
                  {isSelected && (
                    <Check size={18} className="flex-shrink-0 text-primary-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}



